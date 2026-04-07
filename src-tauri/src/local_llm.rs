use encoding_rs::UTF_8;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaChatTemplate, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::{Deserialize, Serialize};
use std::fs;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, OnceLock};

const LOCAL_LLM_MODEL_FILE: &str = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const LOCAL_LLM_MODEL_NAME: &str = "Qwen2.5-1.5B-Instruct Q4_K_M";
const LOCAL_LLM_MIN_MODEL_BYTES: u64 = 1_000_000;
const LOCAL_LLM_CONTEXT_SIZE: u32 = 2_048;
const LOCAL_LLM_MAX_TOKENS: u32 = 160;
const LOCAL_LLM_DEFAULT_STOP_SEQUENCES: &[&str] = &[
    "<|im_end|>",
    "<|end|>",
    "<|endoftext|>",
    "<|eot_id|>",
];

static LOCAL_LLM_WORKER: OnceLock<LocalLlmWorkerHandle> = OnceLock::new();
static LOCAL_LLM_LOADED: AtomicBool = AtomicBool::new(false);

struct LocalLlmWorkerHandle {
    sender: mpsc::Sender<WorkerMessage>,
}

enum WorkerMessage {
    Run {
        request: LocalLlmGenerationRequest,
        respond_to: mpsc::Sender<Result<String, String>>,
    },
    Reset,
}

struct LocalLlmWorkerState {
    backend: Option<LlamaBackend>,
    session: Option<LocalLlmSession>,
}

struct LocalLlmSession {
    model: &'static LlamaModel,
    template: LlamaChatTemplate,
    context: llama_cpp_2::context::LlamaContext<'static>,
    model_path: PathBuf,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalLlmGenerationRequest {
    pub system_prompt: String,
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub stop: Option<Vec<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalLlmRuntimeStatus {
    pub model_ready: bool,
    pub model_name: String,
    pub model_path: Option<String>,
    pub expected_path: String,
    pub install_source_path: Option<String>,
    pub install_action_available: bool,
    pub loaded: bool,
}

fn local_llm_dir() -> Result<PathBuf, String> {
    let dir = crate::app_dir()?.join("models").join("llm");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create local LLM dir: {}", e))?;
    Ok(dir)
}

fn local_llm_model_path() -> Result<PathBuf, String> {
    Ok(local_llm_dir()?.join(LOCAL_LLM_MODEL_FILE))
}

fn is_valid_model_file(path: &Path) -> bool {
    path.is_file()
        && fs::metadata(path)
            .map(|metadata| metadata.len() > LOCAL_LLM_MIN_MODEL_BYTES)
            .unwrap_or(false)
}

fn detect_download_source_path() -> Option<PathBuf> {
    dirs::download_dir()
        .map(|dir| dir.join(LOCAL_LLM_MODEL_FILE))
        .filter(|path| is_valid_model_file(path))
}

fn resolve_dev_bundled_local_llm_model_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let project_root = exe.parent()?.parent()?.parent()?.parent()?;
    let candidate = project_root
        .join("src-tauri")
        .join("resources")
        .join("models")
        .join("llm")
        .join(LOCAL_LLM_MODEL_FILE);
    is_valid_model_file(&candidate).then_some(candidate)
}

fn resolve_bundled_local_llm_model_path(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut push_candidate = |path: PathBuf| {
        if !candidates.iter().any(|candidate| candidate == &path) {
            candidates.push(path);
        }
    };

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));

    if let Some(resource_dir) = resource_dir {
        push_candidate(
            resource_dir
                .join("resources")
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
        push_candidate(
            resource_dir
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
        push_candidate(
            resource_dir
                .join("_up_")
                .join("resources")
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
        push_candidate(
            resource_dir
                .join("_up_")
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
    }

    if let Some(exe_dir) = exe_dir {
        push_candidate(
            exe_dir
                .join("resources")
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
        push_candidate(
            exe_dir
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
        push_candidate(
            exe_dir
                .join("_up_")
                .join("resources")
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
        push_candidate(
            exe_dir
                .join("_up_")
                .join("models")
                .join("llm")
                .join(LOCAL_LLM_MODEL_FILE),
        );
    }

    if let Some(dev_path) = resolve_dev_bundled_local_llm_model_path() {
        push_candidate(dev_path);
    }

    candidates.into_iter().find(|path| is_valid_model_file(path))
}

fn detect_install_source_path(resource_dir: Option<&Path>) -> Option<PathBuf> {
    resolve_bundled_local_llm_model_path(resource_dir).or_else(detect_download_source_path)
}

fn stringify_path(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "Path contains invalid UTF-8".to_string())
}

fn current_local_llm_status() -> Result<LocalLlmRuntimeStatus, String> {
    let expected_path = local_llm_model_path()?;
    let model_ready = is_valid_model_file(&expected_path);
    let install_source_path = detect_install_source_path(None);

    Ok(LocalLlmRuntimeStatus {
        model_ready,
        model_name: LOCAL_LLM_MODEL_NAME.to_string(),
        model_path: if model_ready {
            Some(stringify_path(&expected_path)?)
        } else {
            None
        },
        expected_path: stringify_path(&expected_path)?,
        install_source_path: install_source_path
            .as_ref()
            .and_then(|path| path.to_str().map(str::to_string)),
        install_action_available: install_source_path.is_some(),
        loaded: LOCAL_LLM_LOADED.load(Ordering::Relaxed),
    })
}

fn resolve_install_source(source_path: Option<String>) -> Result<PathBuf, String> {
    match source_path {
        Some(path) if !path.trim().is_empty() => {
            let candidate = PathBuf::from(path.trim());
            if !is_valid_model_file(&candidate) {
                return Err("Selected GGUF file was not found or is incomplete.".to_string());
            }
            Ok(candidate)
        }
        _ => detect_install_source_path(None).ok_or_else(|| {
            format!(
                "Local AI helper was not found in the bundled app resources or Downloads. Expected {}.",
                LOCAL_LLM_MODEL_FILE
            )
        }),
    }
}

fn install_local_llm_from_path(source: &Path, target: &Path) -> Result<(), String> {
    let temp_target = target.with_extension("gguf.part");
    fs::copy(source, &temp_target).map_err(|e| {
        format!(
            "Failed to copy local AI helper from {}: {}",
            source.display(),
            e
        )
    })?;

    if target.exists() {
        fs::remove_file(target)
            .map_err(|e| format!("Failed to replace existing local AI helper: {}", e))?;
    }

    fs::rename(&temp_target, target)
        .map_err(|e| format!("Failed to finalize local AI helper install: {}", e))?;
    reset_local_llm_cache();
    Ok(())
}

fn ensure_local_llm_model_installed(resource_dir: Option<&Path>) -> Result<bool, String> {
    let target = local_llm_model_path()?;
    if is_valid_model_file(&target) {
        return Ok(true);
    }

    let Some(source) = detect_install_source_path(resource_dir) else {
        return Ok(false);
    };

    if source != target {
        install_local_llm_from_path(&source, &target)?;
    }

    Ok(is_valid_model_file(&target))
}

pub(crate) fn seed_local_llm_model_from_bundle(resource_dir: &Path) -> Result<bool, String> {
    ensure_local_llm_model_installed(Some(resource_dir))
}

fn reset_local_llm_cache() {
    LOCAL_LLM_LOADED.store(false, Ordering::Relaxed);
    if let Some(worker) = LOCAL_LLM_WORKER.get() {
        let _ = worker.sender.send(WorkerMessage::Reset);
    }
}

fn get_local_llm_worker() -> Result<&'static LocalLlmWorkerHandle, String> {
    if let Some(worker) = LOCAL_LLM_WORKER.get() {
        return Ok(worker);
    }

    let (sender, receiver) = mpsc::channel::<WorkerMessage>();
    std::thread::Builder::new()
        .name("obs-local-llm".to_string())
        .spawn(move || local_llm_worker_loop(receiver))
        .map_err(|e| format!("Failed to start local LLM worker: {}", e))?;

    let _ = LOCAL_LLM_WORKER.set(LocalLlmWorkerHandle { sender });
    LOCAL_LLM_WORKER
        .get()
        .ok_or_else(|| "Failed to initialize local LLM worker.".to_string())
}

fn local_llm_worker_loop(receiver: mpsc::Receiver<WorkerMessage>) {
    let mut state = LocalLlmWorkerState {
        backend: None,
        session: None,
    };

    while let Ok(message) = receiver.recv() {
        match message {
            WorkerMessage::Run { request, respond_to } => {
                let result = run_local_llm_request(&mut state, request);
                let _ = respond_to.send(result);
            }
            WorkerMessage::Reset => {
                state.session = None;
                LOCAL_LLM_LOADED.store(false, Ordering::Relaxed);
            }
        }
    }
}

fn load_local_llm_session<'a>(
    state: &'a mut LocalLlmWorkerState,
    model_path: &Path,
) -> Result<&'a mut LocalLlmSession, String> {
    let should_reload = state
        .session
        .as_ref()
        .map(|session| session.model_path != model_path)
        .unwrap_or(true);

    if should_reload {
        let backend = match state.backend.take() {
            Some(backend) => backend,
            None => LlamaBackend::init()
                .map_err(|e| format!("Failed to initialize llama.cpp backend: {}", e))?,
        };

        let model = LlamaModel::load_from_file(
            &backend,
            model_path,
            &llama_cpp_2::model::params::LlamaModelParams::default(),
        )
        .map_err(|e| format!("Failed to load local GGUF model: {}", e))?;

        let leaked_model: &'static LlamaModel = Box::leak(Box::new(model));
        let template = match leaked_model.chat_template(None) {
            Ok(template) => template,
            Err(_) => LlamaChatTemplate::new("chatml")
                .map_err(|e| format!("Failed to resolve Qwen chat template: {}", e))?,
        };

        let thread_count = std::thread::available_parallelism()
            .map(|parallelism| parallelism.get().min(8) as i32)
            .unwrap_or(4);
        let context = leaked_model
            .new_context(
                &backend,
                LlamaContextParams::default()
                    .with_n_ctx(NonZeroU32::new(LOCAL_LLM_CONTEXT_SIZE))
                    .with_n_batch(512)
                    .with_n_threads(thread_count)
                    .with_n_threads_batch(thread_count),
            )
            .map_err(|e| format!("Failed to create local LLM context: {}", e))?;

        state.backend = Some(backend);
        state.session = Some(LocalLlmSession {
            model: leaked_model,
            template,
            context,
            model_path: model_path.to_path_buf(),
        });
        LOCAL_LLM_LOADED.store(true, Ordering::Relaxed);
    }

    state
        .session
        .as_mut()
        .ok_or_else(|| "Local LLM session did not initialize.".to_string())
}

fn truncate_at_stop_sequences(mut output: String, stop: Option<&[String]>) -> String {
    let mut cut_index = output.len();

    for sequence in LOCAL_LLM_DEFAULT_STOP_SEQUENCES {
        if let Some(index) = output.find(sequence) {
            cut_index = cut_index.min(index);
        }
    }

    if let Some(extra) = stop {
        for sequence in extra {
            if sequence.is_empty() {
                continue;
            }
            if let Some(index) = output.find(sequence) {
                cut_index = cut_index.min(index);
            }
        }
    }

    output.truncate(cut_index);
    output.trim().to_string()
}

fn generate_with_session(
    session: &mut LocalLlmSession,
    request: LocalLlmGenerationRequest,
) -> Result<String, String> {
    let max_tokens = request.max_tokens.unwrap_or(64).clamp(1, LOCAL_LLM_MAX_TOKENS);
    let mut messages = Vec::new();

    if !request.system_prompt.trim().is_empty() {
        messages.push(
            LlamaChatMessage::new("system".to_string(), request.system_prompt.clone())
                .map_err(|e| format!("Invalid system prompt: {}", e))?,
        );
    }

    messages.push(
        LlamaChatMessage::new("user".to_string(), request.prompt.clone())
            .map_err(|e| format!("Invalid local prompt: {}", e))?,
    );

    session.context.clear_kv_cache();

    let rendered_prompt = session
        .model
        .apply_chat_template(&session.template, &messages, true)
        .map_err(|e| format!("Failed to apply chat template: {}", e))?;
    let prompt_tokens = session
        .model
        .str_to_token(&rendered_prompt, AddBos::Always)
        .map_err(|e| format!("Failed to tokenize local prompt: {}", e))?;

    if prompt_tokens.is_empty() {
        return Err("Local prompt tokenized to zero tokens.".to_string());
    }

    let total_requested_tokens = prompt_tokens.len() + max_tokens as usize;
    if total_requested_tokens >= session.context.n_ctx() as usize {
        return Err("Local prompt is too large for the configured llama.cpp context window.".to_string());
    }

    let mut batch = LlamaBatch::new(prompt_tokens.len() + 1, 1);
    let last_index = (prompt_tokens.len() - 1) as i32;

    for (position, token) in (0_i32..).zip(prompt_tokens.iter().copied()) {
        batch
            .add(token, position, &[0], position == last_index)
            .map_err(|e| format!("Failed to queue prompt token for local inference: {}", e))?;
    }

    session
        .context
        .decode(&mut batch)
        .map_err(|e| format!("llama.cpp prompt decode failed: {}", e))?;

    let mut decoder = UTF_8.new_decoder();
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(0.0),
        LlamaSampler::greedy(),
    ]);
    sampler.reset();

    let mut generated = String::new();
    let mut token_position = batch.n_tokens();
    let token_limit = token_position + max_tokens as i32;

    while token_position < token_limit {
        let token = sampler.sample(&session.context, batch.n_tokens() - 1);
        sampler.accept(token);

        if session.model.is_eog_token(token) {
            break;
        }

        let piece = session
            .model
            .token_to_piece(token, &mut decoder, true, None)
            .map_err(|e| format!("Failed to decode local token piece: {}", e))?;
        generated.push_str(&piece);

        batch.clear();
        batch
            .add(token, token_position, &[0], true)
            .map_err(|e| format!("Failed to queue generated token for local inference: {}", e))?;
        token_position += 1;

        session
            .context
            .decode(&mut batch)
            .map_err(|e| format!("llama.cpp generation decode failed: {}", e))?;
    }

    Ok(truncate_at_stop_sequences(
        generated,
        request.stop.as_deref(),
    ))
}

fn run_local_llm_request(
    state: &mut LocalLlmWorkerState,
    request: LocalLlmGenerationRequest,
) -> Result<String, String> {
    if !ensure_local_llm_model_installed(None)? {
        let model_path = local_llm_model_path()?;
        return Err(format!(
            "Local AI helper is missing. Expected GGUF at {}",
            stringify_path(&model_path)?
        ));
    }

    let model_path = local_llm_model_path()?;
    if !is_valid_model_file(&model_path) {
        return Err(format!(
            "Local AI helper is missing. Expected GGUF at {}",
            stringify_path(&model_path)?
        ));
    }

    let session = load_local_llm_session(state, &model_path)?;
    generate_with_session(session, request)
}

#[tauri::command]
pub(crate) fn get_local_llm_runtime_status() -> Result<LocalLlmRuntimeStatus, String> {
    current_local_llm_status()
}

#[tauri::command]
pub(crate) fn install_local_llm_model(
    source_path: Option<String>,
) -> Result<LocalLlmRuntimeStatus, String> {
    let source = resolve_install_source(source_path)?;
    let target = local_llm_model_path()?;

    if source == target {
        return current_local_llm_status();
    }

    install_local_llm_from_path(&source, &target)?;
    current_local_llm_status()
}

#[tauri::command]
pub(crate) async fn generate_local_llm_text(
    request: LocalLlmGenerationRequest,
) -> Result<String, String> {
    let sender = get_local_llm_worker()?.sender.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let (response_tx, response_rx) = mpsc::channel();
        sender
            .send(WorkerMessage::Run {
                request,
                respond_to: response_tx,
            })
            .map_err(|e| format!("Failed to queue local LLM request: {}", e))?;

        response_rx
            .recv()
            .map_err(|e| format!("Local LLM worker stopped unexpectedly: {}", e))?
    })
    .await
    .map_err(|e| format!("Local LLM task failed: {}", e))?
}
