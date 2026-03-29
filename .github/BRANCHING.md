# Git Branching Strategy — OBS Church Studio

## Branch Structure

```
main                     ← Production-ready. Tagged releases only.
├── develop              ← Integration branch. All features merge here first.
│   ├── feature/*        ← New features (branch from develop, merge back)
│   ├── fix/*            ← Bug fixes (branch from develop, merge back)
│   └── chore/*          ← Refactors, deps, CI (branch from develop)
└── hotfix/*             ← Emergency production fixes (branch from main)
```

## Rules

| Branch            | Created From | Merges Into        | Who Merges      |
|-------------------|--------------|--------------------|-----------------|
| `main`            | —            | —                  | Release only    |
| `develop`         | `main`       | `main` (release)   | After QA pass   |
| `feature/xyz`     | `develop`    | `develop`          | After code review / self-review |
| `fix/xyz`         | `develop`    | `develop`          | After testing   |
| `hotfix/xyz`      | `main`       | `main` + `develop` | Immediately     |

## Naming Convention

```
feature/dashboard-redesign
feature/bible-obs-integration
feature/one-click-presets
fix/overlay-flicker
fix/theme-save-flow
chore/cleanup-dead-code
hotfix/obs-crash-on-push
```

**Pattern:** `{type}/{kebab-case-description}`

## Commit Messages (Conventional Commits)

```
feat(bible): add lower-third size presets
fix(overlay): prevent background flicker on verse change
refactor(dashboard): extract LiveStatusBar component
chore(deps): update obs-websocket-js to v5.1
style(css): align dashboard grid spacing
docs: update branching guide
```

**Format:** `{type}({scope}): {imperative description}`

### Types
- `feat` — New feature or enhancement
- `fix` — Bug fix
- `refactor` — Code restructure (no behavior change)
- `chore` — Build, deps, CI, tooling
- `style` — CSS/formatting only
- `docs` — Documentation
- `test` — Tests
- `perf` — Performance improvement

### Scopes
- `bible` — Bible module (overlays, themes, OBS push)
- `dashboard` — Home/Dashboard page
- `editor` — Layout editor (canvas, inspector, toolbar)
- `overlay` — Browser source overlay HTML
- `obs` — OBS WebSocket service layer
- `mv` — Multi-view system (store, types, templates)
- `ui` — Shared UI components
- `deps` — Dependencies

## Workflow

### Starting New Work
```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-feature
# ... work ...
git add .
git commit -m "feat(scope): description"
```

### Finishing a Feature
```bash
git checkout develop
git merge feature/my-feature --no-ff
git branch -d feature/my-feature
```

### Releasing to Production
```bash
git checkout main
git merge develop --no-ff
git tag -a v1.2.0 -m "Release v1.2.0: Dashboard redesign + Bible OBS integration"
git push origin main --tags
git checkout develop
git merge main  # keep develop in sync
```

### Emergency Hotfix
```bash
git checkout main
git checkout -b hotfix/critical-bug
# ... fix ...
git checkout main && git merge hotfix/critical-bug
git checkout develop && git merge hotfix/critical-bug
git branch -d hotfix/critical-bug
```

## Golden Rules

1. **Never commit directly to `main`** — always merge from `develop` or `hotfix/*`
2. **Never commit directly to `develop`** — always merge from `feature/*` or `fix/*`
3. **One feature per branch** — don't mix unrelated changes
4. **Small, atomic commits** — each commit should compile and make sense alone
5. **Delete branches after merge** — keep the branch list clean
6. **Tag every release** on `main` with semantic versioning (`v1.0.0`)
