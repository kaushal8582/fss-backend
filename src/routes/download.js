const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const {
  downloadRegistrationPdf,
  downloadLicensePdf,
} = require("../services/pdfDownloadService");

const router = express.Router();

function sendDownloadResult(res, result) {
  if (result.authExpired) {
    return res.status(401).json({
      authExpired: true,
      error: result.error || "FSSAI session expired",
    });
  }

  if (result.notFound) {
    return res.status(404).json({ error: result.error });
  }

  if (result.error || !result.pdfBuffer) {
    return res.status(500).json({ error: result.error || "Download failed" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.filename}"`
  );
  res.setHeader("X-Ref-Id", result.refId);
  if (result.companyName) {
    res.setHeader("X-Company-Name", encodeURIComponent(result.companyName));
  }
  return res.send(result.pdfBuffer);
}

router.post("/registration", authMiddleware, async (req, res) => {
  const number = req.body?.number?.trim();
  if (!number) {
    return res.status(400).json({ error: "number is required" });
  }

  try {
    const result = await downloadRegistrationPdf(number);
    return sendDownloadResult(res, result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/license", authMiddleware, async (req, res) => {
  const number = req.body?.number?.trim();
  if (!number) {
    return res.status(400).json({ error: "number is required" });
  }

  try {
    const result = await downloadLicensePdf(number);
    return sendDownloadResult(res, result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
