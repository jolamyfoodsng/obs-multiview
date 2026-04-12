import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import Icon from "./Icon";
import { saveUploadFile } from "../services/layoutEngine";
import {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  type BrandLogoAssetSetting,
  type SpeakerProfileSetting,
} from "../multiview/mvStore";
import { applyBrandingSettingsToDom } from "../services/branding";

const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"] as const;
const LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
const LOGO_ACCEPT = [...LOGO_MIME_TYPES, ...LOGO_EXTENSIONS].join(",");

function hasAllowedLogoExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return LOGO_EXTENSIONS.includes(filename.slice(dot).toLowerCase() as (typeof LOGO_EXTENSIONS)[number]);
}

function resolveLogoPreviewSrc(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|blob:|asset:)/i.test(trimmed)) return trimmed;
  return convertFileSrc(trimmed);
}

function buildLogoAsset(path: string, name: string): BrandLogoAssetSetting {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `logo-${Date.now()}`,
    name: name.trim() || path.split(/[\\/]/).pop()?.trim() || "Church logo",
    path,
    createdAt: new Date().toISOString(),
  };
}

function buildPastorSpeaker(mainPastorName: string): SpeakerProfileSetting[] {
  const name = mainPastorName.trim();
  return name ? [{ name, role: "Lead Pastor" }] : [];
}

function toColorInputValue(value: string, fallback = DEFAULT_SETTINGS.brandColor): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

type ChurchProfileOnboardingModalProps = {
  onComplete: () => void;
};

export function ChurchProfileOnboardingModal({ onComplete }: ChurchProfileOnboardingModalProps) {
  const existing = useMemo(() => getSettings(), []);
  const [churchName, setChurchName] = useState(existing.churchName);
  const [mainPastorName, setMainPastorName] = useState(existing.mainPastorName || existing.pastorSpeakers[0]?.name || "");
  const [brandColor, setBrandColor] = useState(existing.brandColor || DEFAULT_SETTINGS.brandColor);
  const [brandSecondaryColor, setBrandSecondaryColor] = useState(existing.brandSecondaryColor);
  const [brandLogoPath, setBrandLogoPath] = useState(existing.brandLogoPath);
  const [brandLogoAssets, setBrandLogoAssets] = useState<BrandLogoAssetSetting[]>(existing.brandLogoAssets);
  const [step, setStep] = useState<1 | 2>(1);
  const [logoStatus, setLogoStatus] = useState("");
  const [logoError, setLogoError] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const logoPreviewSrc = useMemo(() => {
    try {
      return resolveLogoPreviewSrc(brandLogoPath);
    } catch {
      return "";
    }
  }, [brandLogoPath]);

  const churchNameError = submitted && !churchName.trim() ? "Church name is required to finish setup." : "";
  const primaryColorInputValue = toColorInputValue(brandColor);
  const secondaryColorInputValue = toColorInputValue(brandSecondaryColor, primaryColorInputValue);

  const persistProfile = () => {
    const pastorSpeakers = buildPastorSpeaker(mainPastorName);
    const next = updateSettings({
      churchName: churchName.trim(),
      mainPastorName: mainPastorName.trim(),
      pastorNames: pastorSpeakers.map((profile) => profile.name).join("\n"),
      pastorSpeakers,
      brandColor: brandColor.trim() || DEFAULT_SETTINGS.brandColor,
      brandSecondaryColor: brandSecondaryColor.trim(),
      brandLogoPath: brandLogoPath.trim(),
      brandLogoAssets,
      churchProfileOnboardingCompleted: true,
    });
    applyBrandingSettingsToDom({ brandColor: next.brandColor, churchName: next.churchName });
    onComplete();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!churchName.trim()) return;
    if (step === 1) {
      setSubmitted(false);
      setStep(2);
      return;
    }
    persistProfile();
  };

  const handleContinue = () => {
    setSubmitted(true);
    if (!churchName.trim()) return;
    setSubmitted(false);
    setStep(2);
  };

  const handleSkip = () => {
    updateSettings({ churchProfileOnboardingCompleted: true });
    onComplete();
  };

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isImageMime = file.type.startsWith("image/");
    const isAllowedExt = hasAllowedLogoExtension(file.name);
    if (!isImageMime && !isAllowedExt) {
      setLogoError("Use PNG, JPG, WEBP, GIF, or SVG.");
      setLogoStatus("");
      event.target.value = "";
      return;
    }

    setUploadingLogo(true);
    setLogoError("");
    try {
      const absolutePath = await saveUploadFile(file);
      const asset = buildLogoAsset(absolutePath, file.name);
      setBrandLogoPath(absolutePath);
      setBrandLogoAssets((prev) => [...prev.filter((item) => item.path !== absolutePath), asset]);
      setLogoStatus(file.name);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Logo upload failed.");
      setLogoStatus("");
    } finally {
      setUploadingLogo(false);
      event.target.value = "";
    }
  };

  return (
    <div className="church-onboarding" role="presentation">
      <div className="church-onboarding__panel" role="dialog" aria-modal="true" aria-labelledby="church-onboarding-title">
        <form className="church-onboarding__form" onSubmit={handleSubmit}>
          <div className="church-onboarding__header">
            <div className="church-onboarding__mark" aria-hidden="true">
              <Icon name="church" size={22} />
            </div>
            <div>
              <p className="church-onboarding__eyebrow">First launch</p>
              <h1 id="church-onboarding-title">Set up your church profile</h1>
              <p>This helps personalize your screens and templates.</p>
            </div>
            <span className="church-onboarding__step">{step}/2</span>
          </div>

          <div className="church-onboarding__grid">
            {step === 1 ? (
              <>
                <label className="church-onboarding__field church-onboarding__field--wide">
                  <span>Church name</span>
                  <input
                    type="text"
                    value={churchName}
                    onChange={(event) => setChurchName(event.target.value)}
                    placeholder="e.g. Grace Chapel"
                    autoFocus
                    aria-invalid={Boolean(churchNameError)}
                    aria-describedby={churchNameError ? "church-onboarding-name-error" : undefined}
                  />
                  {churchNameError && (
                    <small id="church-onboarding-name-error" className="church-onboarding__error">
                      {churchNameError}
                    </small>
                  )}
                </label>

                <label className="church-onboarding__field church-onboarding__field--wide">
                  <span>Main pastor name <em>Optional</em></span>
                  <input
                    type="text"
                    value={mainPastorName}
                    onChange={(event) => setMainPastorName(event.target.value)}
                    placeholder="e.g. Pastor Tayo Akosile"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="church-onboarding__upload">
                  <div className="church-onboarding__logo-preview" aria-label="Logo preview">
                    {logoPreviewSrc ? (
                      <img src={logoPreviewSrc} alt="Uploaded church logo preview" />
                    ) : (
                      <span>No logo</span>
                    )}
                  </div>
                  <label className="church-onboarding__upload-button">
                    <Icon name="upload" size={16} />
                    {uploadingLogo ? "Uploading..." : "Upload primary logo"}
                    <input
                      type="file"
                      accept={LOGO_ACCEPT}
                      onChange={(event) => void handleLogoUpload(event)}
                      disabled={uploadingLogo}
                    />
                  </label>
                  <p>PNG, JPG, WEBP, GIF, or SVG. You can skip this.</p>
                  {logoStatus && <small className="church-onboarding__ok">Logo ready: {logoStatus}</small>}
                  {logoError && <small className="church-onboarding__error">{logoError}</small>}
                </div>

                <div className="church-onboarding__colors" aria-label="Brand colors">
                  <label className="church-onboarding__field">
                    <span>Primary color</span>
                    <div className="church-onboarding__color-row">
                      <input type="color" value={primaryColorInputValue} onChange={(event) => setBrandColor(event.target.value)} />
                      <input type="text" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} />
                    </div>
                  </label>
                  <label className="church-onboarding__field">
                    <span>Secondary color <em>Optional</em></span>
                    <div className="church-onboarding__color-row">
                      <input
                        type="color"
                        value={secondaryColorInputValue}
                        onChange={(event) => setBrandSecondaryColor(event.target.value)}
                      />
                      <input
                        type="text"
                        value={brandSecondaryColor}
                        onChange={(event) => setBrandSecondaryColor(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="church-onboarding__footer">
            <button type="button" className="church-onboarding__button church-onboarding__button--ghost" onClick={handleSkip}>
              Skip for now
            </button>
            <div className="church-onboarding__actions">
              {step === 2 && (
                <button type="button" className="church-onboarding__button church-onboarding__button--secondary" onClick={() => setStep(1)}>
                  Back
                </button>
              )}
              {step === 1 ? (
                <button type="button" className="church-onboarding__button church-onboarding__button--primary" onClick={handleContinue}>
                  Continue
                </button>
              ) : (
                <button type="submit" className="church-onboarding__button church-onboarding__button--primary">
                  Finish setup
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
