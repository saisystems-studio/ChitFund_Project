// Meaningful, collision-resistant export filenames across every report page, e.g.
// "Customer_Wise_Report_Kumar_06-10-2026" / "Active_Loans_06-10-2026" — never "report1"/"download".
const sanitize = part => String(part || "").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

export function reportFilename(reportName, ...scopeParts) {
  const today = new Date().toLocaleDateString("en-GB").replace(/\//g, "-"); // DD-MM-YYYY
  return [reportName, ...scopeParts, today].map(sanitize).filter(Boolean).join("_");
}
