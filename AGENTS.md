# Repository Guidelines

## Project Structure & Module Organization
This repository is a static web UI package.
- Root: standalone HTML pages for each screen (for example, `教师登录页.html`, `课堂教学主界面.html`, `管理后台仪表盘.html`).
- `assets/html/97017/`: compiled/shared stylesheet assets (for example, `admin-dashboard.DojKgBok.css`).
- `assets/static/uxbot/25_6/`: shared JavaScript utilities (for example, `holder.js`).
- `最终版.zip`: release artifact; do not edit in place. Rebuild/export it from source files when needed.

Keep page-specific logic in the corresponding HTML file and place reusable CSS/JS under `assets/`.

## Build, Test, and Development Commands
No build system is configured in this directory.
- `python -m http.server 8000`: run a local static server for preview.
- `start http://localhost:8000/教师登录页.html`: open a page directly in browser (PowerShell).
- `Get-ChildItem *.html`: list entry pages before review or packaging.

If you introduce a build tool, document commands here and in the PR.

## Coding Style & Naming Conventions
- Use 2 spaces for HTML/CSS/JS indentation.
- Prefer semantic HTML sections (`header`, `main`, `section`) over deeply nested `div`s.
- Use kebab-case for new asset filenames (for example, `student-evaluation.css`, `attendance-board.js`).
- Preserve existing Chinese page names unless a migration is planned.
- Keep shared styles in `assets/` and avoid duplicating large inline `<style>` blocks across pages.

## Testing Guidelines
Automated tests are not configured yet.
- Manually verify changed pages in latest Chrome and Edge.
- Validate navigation links, responsive layout (desktop + mobile width), and console errors.
- For JS changes, include a short test checklist in the PR description.

## Commit & Pull Request Guidelines
Git history is not available in this folder, so use this convention going forward.
- Commit format: `type(scope): summary` (for example, `feat(login): add validation hints`).
- Keep commits focused on one screen or one concern.
- PRs should include: purpose, affected files, before/after screenshots for UI changes, and manual test notes.
- Link related task/issue IDs when available.

## Security & Configuration Tips
- Do not commit secrets, tokens, or real student data in HTML/JS.
- Use placeholder/mock data for demos.
- Review third-party assets in `assets/static/` before upgrading versions.
