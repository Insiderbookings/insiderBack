import PDFDocument from "pdfkit";

const formatNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
};

const formatPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric > 0 ? "+" : ""}${numeric}%`;
};

const drawMetricCard = ({ doc, x, y, width, title, value, helper, accent = "#0f172a" }) => {
  doc
    .save()
    .roundedRect(x, y, width, 90, 16)
    .fillAndStroke("#f8fafc", "#e2e8f0")
    .restore();
  doc
    .fillColor("#64748b")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(title, x + 16, y + 16, { width: width - 32 });
  doc
    .fillColor(accent)
    .font("Helvetica-Bold")
    .fontSize(28)
    .text(value, x + 16, y + 34, { width: width - 32 });
  if (helper) {
    doc
      .fillColor("#475569")
      .font("Helvetica")
      .fontSize(10)
      .text(helper, x + 16, y + 66, { width: width - 32 });
  }
};

export const buildPartnerMonthlyReportPdfBuffer = async ({
  claim,
  monthlyReport,
  competitorInsights,
}) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "LETTER", margin: 42 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const hotelName = claim?.hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
      const location = [claim?.hotel?.city_name, claim?.hotel?.country_name].filter(Boolean).join(", ");
      const monthLabel = monthlyReport?.monthLabel || "Current month";

      doc
        .fillColor("#be123c")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text("BookingGPT Partners", 42, 42);
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(26)
        .text(`${monthLabel} performance report`, 42, 64);
      doc
        .fillColor("#475569")
        .font("Helvetica")
        .fontSize(12)
        .text(`${hotelName}${location ? ` · ${location}` : ""}`, 42, 98);

      drawMetricCard({
        doc,
        x: 42,
        y: 138,
        width: 160,
        title: "BookingGPT Reach",
        value: formatNumber(monthlyReport?.reach),
        helper: `${formatPercent(monthlyReport?.reachDeltaPercent)} vs previous month`,
        accent: "#7B2FBE",
      });
      drawMetricCard({
        doc,
        x: 216,
        y: 138,
        width: 160,
        title: "Clicks",
        value: formatNumber(monthlyReport?.clicks),
        helper: `${formatPercent(monthlyReport?.clicksDeltaPercent)} vs previous month`,
        accent: "#1877F2",
      });
      drawMetricCard({
        doc,
        x: 390,
        y: 138,
        width: 180,
        title: "CTR",
        value: monthlyReport?.ctrPercent != null ? `${monthlyReport.ctrPercent}%` : "-",
        helper: monthlyReport?.previousCtrPercent != null ? `Previous ${monthlyReport.previousCtrPercent}%` : null,
        accent: "#22C55E",
      });

      let cursorY = 258;
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(15)
        .text("Surface mix", 42, cursorY);
      cursorY += 22;

      (monthlyReport?.surfaceSummary || []).forEach((surface) => {
        doc
          .save()
          .roundedRect(42, cursorY, 528, 34, 12)
          .fillAndStroke("#ffffff", "#e2e8f0")
          .restore();
        doc
          .fillColor("#0f172a")
          .font("Helvetica-Bold")
          .fontSize(11)
          .text(surface.label, 56, cursorY + 10, { width: 180 });
        doc
          .fillColor("#475569")
          .font("Helvetica")
          .fontSize(11)
          .text(`${formatNumber(surface.impressions)} reach`, 280, cursorY + 10, { width: 100 });
        doc.text(`${formatNumber(surface.clicks)} clicks`, 392, cursorY + 10, { width: 100 });
        cursorY += 42;
      });

      cursorY += 8;
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(15)
        .text("Competitor insights", 42, cursorY);
      cursorY += 22;
      const insightsRows = [
        ["City cohort", competitorInsights?.city ? `${competitorInsights.city} (${formatNumber(competitorInsights?.cohortSize)} hotels)` : "-"],
        ["Average city reach", formatNumber(competitorInsights?.averageReach)],
        ["Average city clicks", formatNumber(competitorInsights?.averageClicks)],
        ["Average city CTR", competitorInsights?.averageCtrPercent != null ? `${competitorInsights.averageCtrPercent}%` : "-"],
        ["Reach vs city", formatPercent(competitorInsights?.reachVsCityPercent)],
        ["Clicks vs city", formatPercent(competitorInsights?.clicksVsCityPercent)],
        ["Hotel rank in city", competitorInsights?.hotelRankInCity ? `#${competitorInsights.hotelRankInCity}` : "-"],
      ];

      insightsRows.forEach(([label, value]) => {
        doc
          .save()
          .roundedRect(42, cursorY, 528, 30, 12)
          .fillAndStroke("#f8fafc", "#e2e8f0")
          .restore();
        doc
          .fillColor("#64748b")
          .font("Helvetica")
          .fontSize(10)
          .text(label, 56, cursorY + 10, { width: 220 });
        doc
          .fillColor("#0f172a")
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(String(value || "-"), 280, cursorY + 10, { width: 270, align: "right" });
        cursorY += 36;
      });

      doc
        .fillColor("#94a3b8")
        .font("Helvetica")
        .fontSize(9)
        .text(
          "BookingGPT Reach combines in-app tracking with approved manual social additions. Competitor insights are city averages and never expose hotel names.",
          42,
          720,
          { width: 528, align: "left" },
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

export default {
  buildPartnerMonthlyReportPdfBuffer,
};
