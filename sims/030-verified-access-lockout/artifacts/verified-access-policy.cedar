// Verified Access group: hollowfield-internal-apps
// Last modified: 2026-04-18T19:12:04Z by arn:aws:iam::614522301847:user/platform-migration
// Applies to: 5 endpoints
//   hollowfield-admin-vae (admin.hollowfield.internal)
//   hollowfield-wiki-vae (wiki.hollowfield.internal)
//   hollowfield-metrics-vae (metrics.hollowfield.internal)
//   hollowfield-budget-vae (budget.hollowfield.internal)
//   hollowfield-support-vae (support.hollowfield.internal)

permit (
    principal,
    action,
    resource
)
when {
    context.okta.groups.contains("hollowfield-engineering")
};
