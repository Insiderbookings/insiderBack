import PDFDocument from "pdfkit";

const PAGE_SIZE = "LETTER";
const PAGE_MARGIN = 42;
const BRAND_DARK = "#0f172a";
const BRAND_MUTED = "#64748b";
const BRAND_ACCENT = "#ff385c";
const SURFACE = "#f8fafc";
const BORDER = "#e2e8f0";
const SUCCESS = "#15803d";
const WARN = "#c2410c";

const formatCount = (value) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const formatMonthDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Monthly report";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const formatShortDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const coercePlain = (value) => (value?.get ? value.get({ plain: true }) : value || {});

const renderDeltaLabel = (comparison = {}) => {
  const current = Number(comparison?.current || 0);
  const previous = Number(comparison?.previous || 0);
  if (previous <= 0 && current <= 0) return "No movement yet";
  if (previous <= 0 && current > 0) return "New this month";
  const delta = Number(comparison?.delta || 0);
  const percentage = Number(comparison?.percentage || 0);
  if (!delta) return "Flat vs previous month";
  const direction = delta > 0 ? "Up" : "Down";
  return `${direction} ${Math.abs(percentage)}% vs previous month`;
};

const drawKpiCard = ({ doc, x, y, width, height, label, value, note }) => {
  doc.save();
  doc.roundedRect(x, y, width, height, 16).fillAndStroke(SURFACE, BORDER);
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(label, x + 14, y + 12, {
      width: width - 28,
      lineBreak: false,
    });
  doc
    .fillColor(BRAND_DARK)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text(value, x + 14, y + 30, {
      width: width - 28,
    });
  if (note) {
    doc
      .fillColor(BRAND_MUTED)
      .fontSize(9)
      .font("Helvetica")
      .text(note, x + 14, y + height - 28, {
        width: width - 28,
      });
  }
  doc.restore();
};

const drawBulletList = ({ doc, items = [], x, y, width, bulletColor = BRAND_ACCENT }) => {
  let cursorY = y;
  items.forEach((item) => {
    doc.save();
    doc.circle(x + 4, cursorY + 7, 2.5).fill(bulletColor);
    doc.restore();
    doc
      .fillColor(BRAND_DARK)
      .fontSize(11)
      .font("Helvetica")
      .text(String(item || ""), x + 14, cursorY, {
        width: width - 14,
        lineGap: 2,
      });
    cursorY = doc.y + 8;
  });
  return cursorY;
};

const drawMetricRow = ({ doc, label, value, note, y, tone = "default" }) => {
  const textColor = tone === "success" ? SUCCESS : tone === "warn" ? WARN : BRAND_DARK;
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(label, PAGE_MARGIN, y, {
      width: 210,
      lineBreak: false,
    });
  doc
    .fillColor(textColor)
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(value, PAGE_MARGIN + 220, y, {
      width: 120,
      align: "right",
      lineBreak: false,
    });
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(10)
    .font("Helvetica")
    .text(note, PAGE_MARGIN + 360, y, {
      width: 190,
      align: "left",
    });
  doc
    .save()
    .moveTo(PAGE_MARGIN, y + 22)
    .lineTo(doc.page.width - PAGE_MARGIN, y + 22)
    .strokeColor(BORDER)
    .stroke()
    .restore();
  return y + 30;
};

const addFooter = (doc) => {
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(8)
    .font("Helvetica")
    .text(
      "BookingGPT Partners monthly report",
      PAGE_MARGIN,
      doc.page.height - 26,
      {
        width: doc.page.width - PAGE_MARGIN * 2,
        align: "center",
      },
    );
};

const buildPdf = (doc, { claim, hotel, report }) => {
  const plainClaim = coercePlain(claim);
  const plainHotel = coercePlain(hotel);
  const plainReport = coercePlain(report);
  const metrics = plainReport.metrics || {};
  const summary = plainReport.summary || {};
  const monthLabel = metrics?.reportMonthLabel || formatMonthDate(plainReport.report_month);
  const trackedViews = metrics?.visibility?.trackedViews || {};
  const favorites = metrics?.favorites?.newThisMonth || {};
  const inquiries = metrics?.inquiries?.total || {};
  const deliveredInquiries = Number(metrics?.inquiries?.delivered || 0);
  const clicksSnapshot = Number(metrics?.visibility?.clicksSnapshot || 0);
  const reportEmailStatus = String(plainReport.delivery_status || "PENDING").toUpperCase();
  const reportEmailLabel =
    reportEmailStatus === "SENT"
      ? `Sent to ${plainReport.delivered_to_email || plainClaim.contact_email || "partner inbox"}`
      : reportEmailStatus === "FAILED"
        ? "Email delivery failed"
        : reportEmailStatus === "SKIPPED"
          ? "Generated without email delivery"
          : "Generated and ready";
  const deliveryTone = reportEmailStatus === "FAILED" ? "warn" : reportEmailStatus === "SENT" ? "success" : "default";

  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  const cardGap = 14;
  const cardWidth = (contentWidth - cardGap) / 2;

  doc
    .fillColor(BRAND_MUTED)
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("BookingGPT Partners", PAGE_MARGIN, PAGE_MARGIN);
  doc
    .fillColor(BRAND_DARK)
    .fontSize(24)
    .font("Helvetica-Bold")
    .text(`${monthLabel} performance report`, PAGE_MARGIN, PAGE_MARGIN + 18, {
      width: contentWidth,
    });
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(11)
    .font("Helvetica")
    .text(
      `${plainHotel.name || `Hotel ${plainClaim.hotel_id || ""}`.trim()}${plainHotel.city_name ? ` · ${plainHotel.city_name}` : ""}${plainHotel.country_name ? `, ${plainHotel.country_name}` : ""}`,
      PAGE_MARGIN,
      PAGE_MARGIN + 54,
      {
        width: contentWidth,
      },
    );
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(10)
    .font("Helvetica")
    .text(
      summary?.partialMonthNote || "Monthly executive summary based on BookingGPT partner activity.",
      PAGE_MARGIN,
      PAGE_MARGIN + 72,
      {
        width: contentWidth,
      },
    );

  const cardsTop = PAGE_MARGIN + 108;
  drawKpiCard({
    doc,
    x: PAGE_MARGIN,
    y: cardsTop,
    width: cardWidth,
    height: 92,
    label: "Tracked views",
    value: formatCount(trackedViews.current),
    note: renderDeltaLabel(trackedViews),
  });
  drawKpiCard({
    doc,
    x: PAGE_MARGIN + cardWidth + cardGap,
    y: cardsTop,
    width: cardWidth,
    height: 92,
    label: "New favorites",
    value: formatCount(favorites.current),
    note: renderDeltaLabel(favorites),
  });
  drawKpiCard({
    doc,
    x: PAGE_MARGIN,
    y: cardsTop + 104,
    width: cardWidth,
    height: 92,
    label: "Traveler inquiries",
    value: formatCount(inquiries.current),
    note: `${formatCount(deliveredInquiries)} delivered to the hotel`,
  });
  drawKpiCard({
    doc,
    x: PAGE_MARGIN + cardWidth + cardGap,
    y: cardsTop + 104,
    width: cardWidth,
    height: 92,
    label: "Click snapshot",
    value: formatCount(clicksSnapshot),
    note: "Current partner-provided click total",
  });

  let cursorY = cardsTop + 220;
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("Executive summary", PAGE_MARGIN, cursorY);
  cursorY += 18;
  doc
    .fillColor(BRAND_DARK)
    .fontSize(15)
    .font("Helvetica-Bold")
    .text(summary?.headline || "Monthly visibility summary", PAGE_MARGIN, cursorY, {
      width: contentWidth,
      lineGap: 2,
    });
  cursorY = doc.y + 10;
  cursorY = drawBulletList({
    doc,
    items: Array.isArray(summary?.highlights) && summary.highlights.length ? summary.highlights : [],
    x: PAGE_MARGIN,
    y: cursorY,
    width: contentWidth,
  });

  doc.addPage({ size: PAGE_SIZE, margin: PAGE_MARGIN });
  doc
    .fillColor(BRAND_DARK)
    .fontSize(18)
    .font("Helvetica-Bold")
    .text("Operational detail", PAGE_MARGIN, PAGE_MARGIN);
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(10)
    .font("Helvetica")
    .text("This page is meant for the hotel team that needs the details behind the monthly summary.", PAGE_MARGIN, PAGE_MARGIN + 24, {
      width: contentWidth,
    });

  let detailY = PAGE_MARGIN + 62;
  detailY = drawMetricRow({
    doc,
    label: "Tracked views this month",
    value: formatCount(trackedViews.current),
    note: renderDeltaLabel(trackedViews),
    y: detailY,
  });
  detailY = drawMetricRow({
    doc,
    label: "New favorites this month",
    value: formatCount(favorites.current),
    note: renderDeltaLabel(favorites),
    y: detailY,
  });
  detailY = drawMetricRow({
    doc,
    label: "Traveler inquiries",
    value: formatCount(inquiries.current),
    note: `${formatCount(deliveredInquiries)} delivered · ${formatCount(metrics?.inquiries?.deliveryIssues || 0)} issues`,
    y: detailY,
  });
  detailY = drawMetricRow({
    doc,
    label: "Profile completion",
    value: `${formatCount(metrics?.profile?.completionPercent || 0)}%`,
    note: metrics?.profile?.completionPercent >= 80 ? "Strong public profile coverage" : "There is still room to improve the profile story",
    y: detailY,
    tone: Number(metrics?.profile?.completionPercent || 0) >= 80 ? "success" : "default",
  });
  detailY = drawMetricRow({
    doc,
    label: "Inquiry routing",
    value: metrics?.profile?.inquiryReady ? "Ready" : "Needs setup",
    note: metrics?.profile?.inquiryReady ? "Travelers can already contact the hotel directly" : "Complete the inquiry setup to turn visibility into direct leads",
    y: detailY,
    tone: metrics?.profile?.inquiryReady ? "success" : "warn",
  });
  detailY = drawMetricRow({
    doc,
    label: "Special offer module",
    value: metrics?.profile?.specialOffersEnabled ? "Live" : "Not active",
    note: metrics?.profile?.specialOffersEnabled ? "Promotional messaging is active on the public profile" : "A live offer can strengthen conversion on the listing",
    y: detailY,
    tone: metrics?.profile?.specialOffersEnabled ? "success" : "default",
  });
  detailY = drawMetricRow({
    doc,
    label: "Report delivery",
    value: reportEmailStatus,
    note: reportEmailLabel,
    y: detailY,
    tone: deliveryTone,
  });

  detailY += 12;
  doc
    .fillColor(BRAND_MUTED)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("Recommended next actions", PAGE_MARGIN, detailY);
  detailY += 18;
  drawBulletList({
    doc,
    items: Array.isArray(summary?.nextActions) && summary.nextActions.length ? summary.nextActions : ["Keep the profile current and review the next monthly report for trend changes."],
    x: PAGE_MARGIN,
    y: detailY,
    width: contentWidth,
    bulletColor: SUCCESS,
  });

  addFooter(doc);
};

export const bufferPartnerMonthlyReportPdf = ({ claim, hotel, report } = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: PAGE_SIZE, margin: PAGE_MARGIN });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    buildPdf(doc, { claim, hotel, report });
    doc.end();
  });

export const buildPartnerMonthlyReportFilename = ({
  hotelId = null,
  reportMonth = null,
} = {}) => {
  const safeHotelId = String(hotelId || "hotel").replace(/[^a-z0-9_-]/gi, "-");
  const safeMonth = String(reportMonth || "report").replace(/[^0-9-]/g, "");
  return `bookinggpt-partner-report-${safeHotelId}-${safeMonth}.pdf`;
};

export const formatPartnerMonthlyReportDateLabel = formatMonthDate;
export const formatPartnerMonthlyReportShortDate = formatShortDate;
