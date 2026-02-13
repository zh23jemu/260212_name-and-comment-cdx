# Migration QA Checklist

## Preconditions
- Backend started with `npm run start` in `server/`.
- Browser opened from `http://<server-ip>:3000/` (do not use `file://`).
- Clear old browser storage once before first validation.

## Page-by-page checks
1. `教师登录页.html`
- Login with `teacher / 123456`.
- Confirm no fatal error in browser console.

2. `课堂教学主界面.html`
- Load class and student area without blank sections.
- Trigger one attendance action if UI exposes it.

3. `学生评价选择页.html`
- Open student card and submit one evaluation.
- Return to previous page and confirm flow is not broken.

4. `点名与评价统计页.html`
- Verify latest attendance/evaluation records appear.

5. `实时数据看板.html` and `数据汇总报表.html`
- Refresh and verify aggregated counts are updated.

6. `班级学生管理.html`
- Verify student list renders from database state.

## Persistence checks
- Stop server, restart server, reload pages.
- Confirm previously created attendance/evaluation data still exists.

## Multi-client checks
- Open same page from two browsers/devices.
- Perform one write operation in client A, refresh client B.
- Confirm latest data appears in client B.
