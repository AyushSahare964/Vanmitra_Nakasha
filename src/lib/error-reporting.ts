// Application Error Boundary and Diagnostic Reporting
export function reportAppError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("[VANMITRA GIS System Error]:", error, context);
}
