const {
  foscosRequest,
  downloadRegistrationPdfBuffer,
  downloadLicensePdfBuffer,
} = require("./fssaiClient");
const { encryptRequest, decryptResponse } = require("./fssaiCrypto");
const { getCredentials, getTokenExpiryWarning } = require("./authCredentials");
const { getCompleteRegistrationPrev } = require("./expressRenewalClient");
const { env } = require("../config/env");
const {
  refreshFssaiAuth,
  isAutoRefreshConfigured,
} = require("./fssaiAuthService");

const LICENSE_CATEGORY_IDS = [2, 1, 3];

function buildSearchPayload(certificateNumber, apptype = "R") {
  return {
    apptype,
    premiseState: null,
    premiseDistrict: null,
    companyName: null,
    flrsLicenseNo: certificateNumber,
    kobId: null,
    fpvsCategoryId: null,
    premiseTaluk: null,
    fpvsSubCategoryId: null,
    fpvsProductId: null,
    eligibility: null,
    kobType: null,
    statusId: null,
    businessType: null,
    licenseCategoryId: "",
    productId: null,
  };
}

function extractRecords(decrypted) {
  return (
    decrypted.paginationListRecords ||
    decrypted.searchResultList ||
    decrypted.records ||
    []
  );
}

function normalizeLicenseCategoryId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function searchRefIdPage(certificateNumber, apptype = "R", page = 1) {
  const encryptedPayload = encryptRequest(
    JSON.stringify(buildSearchPayload(certificateNumber, apptype))
  );

  const response = await foscosRequest(
    "POST",
    `/webgateway/commonauth_readonly/commonapi/getadvancesearchapplicationdetails/${page}`,
    { encryptedPayload },
    { skipAuth: true }
  );

  if (response.status !== 200) {
    throw new Error(
      `Search failed (${response.status}): ${response.body.toString("utf8").slice(0, 300)}`
    );
  }

  const parsed = JSON.parse(response.body.toString("utf8"));
  if (!parsed.encryptedResponse) {
    throw new Error("Search response missing encryptedResponse");
  }

  const decrypted = JSON.parse(decryptResponse(parsed.encryptedResponse));
  return {
    records: extractRecords(decrypted),
    totalPages: decrypted.totalPages || 0,
    pageLimit: decrypted.pageLimit || 10,
  };
}

async function searchRefIdAll(certificateNumber, apptype = "R") {
  const allRecords = [];

  for (let page = 1; page <= 50; page++) {
    const { records, totalPages, pageLimit } = await searchRefIdPage(
      certificateNumber,
      apptype,
      page
    );

    if (!records.length) {
      break;
    }

    allRecords.push(...records);

    if (totalPages > 0 && page >= totalPages) {
      break;
    }
    if (records.length < pageLimit) {
      break;
    }
  }

  return allRecords;
}

function getLicenseNumber(record) {
  return record?.licenseno || record?.licenseNo || record?.flrsLicenseNo || "";
}

function recordToMatch(record, apptype) {
  const refId = record.refId || record.refid;
  if (!refId) {
    return null;
  }

  return {
    refId: String(refId),
    certificateNumber: getLicenseNumber(record),
    companyName: (record.companyname || record.companyName || "").trim(),
    licenseCategory: record.licensecategoryname || record.licenseCategoryName || "",
    licenseCategoryId:
      normalizeLicenseCategoryId(
        record.licensecategoryid || record.licenseCategoryId
      ) || 2,
    status: record.statusdesc || record.statusDesc || "",
    state: record.statename || record.stateName || "",
    district: record.districtname || record.districtName || "",
    apptype,
    record,
  };
}

async function searchCertificateAll(certificateNumber, preferApptype = "R") {
  const primaryApptype = preferApptype === "L" ? "L" : "R";
  const fallbackApptype = primaryApptype === "R" ? "L" : "R";

  const primaryRecords = await searchRefIdAll(certificateNumber, primaryApptype);
  if (primaryRecords.length > 0) {
    return primaryRecords
      .map((record) => recordToMatch(record, primaryApptype))
      .filter(Boolean);
  }

  const fallbackRecords = await searchRefIdAll(certificateNumber, fallbackApptype);
  return fallbackRecords
    .map((record) => recordToMatch(record, fallbackApptype))
    .filter(Boolean);
}

async function searchLicenseOnly(certificateNumber) {
  const records = await searchRefIdAll(certificateNumber, "L");
  return records.map((record) => recordToMatch(record, "L")).filter(Boolean);
}

function parseCertificateDigits(input) {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 13 || digits.length === 14) {
    return digits;
  }
  throw new Error(
    `Invalid certificate number length (${digits.length} digits). Use 14 digits, or refId.`
  );
}

function looksLikeRefId(value) {
  return /^\d{6,10}$/.test(value);
}

async function lookupRegistration(refId) {
  const data = await getCompleteRegistrationPrev(String(refId));
  return data.fboDetails || data;
}

async function buildSuffixRefIdMap(prefix13) {
  const entries = await Promise.all(
    Array.from({ length: 10 }, async (_, digit) => {
      const records = await searchRefIdAll(`${prefix13}${digit}`, "R");
      const record = records[0];
      return record ? [digit, Number(record.refid || record.refId)] : null;
    })
  );

  const map = {};
  for (const entry of entries) {
    if (entry) {
      map[entry[0]] = entry[1];
    }
  }
  return map;
}

async function findOriginalRegistrationRefId(searchRefId, fbo, suffixRefIdsByDigit) {
  const cert = fbo.certificateNo;
  const fboId = fbo.fboId;
  const suffixDigit = Number(cert.slice(-1));
  const lowRef = suffixRefIdsByDigit[Math.max(0, suffixDigit - 2)];
  const highRef = suffixRefIdsByDigit[Math.max(0, suffixDigit - 1)];

  if (!cert || !fboId || !lowRef || !highRef || lowRef >= highRef) {
    return String(searchRefId);
  }

  const batchSize = 200;
  for (let end = highRef; end >= lowRef; end -= batchSize) {
    const start = Math.max(lowRef, end - batchSize + 1);
    const ids = [];
    for (let id = end; id >= start; id -= 1) {
      ids.push(id);
    }

    const hits = await Promise.all(
      ids.map(async (id) => {
        try {
          const candidate = await lookupRegistration(id);
          if (
            candidate.certificateNo === cert &&
            candidate.fboId === fboId &&
            candidate.apptypeDesc === "New Registration"
          ) {
            return id;
          }
        } catch {
          return null;
        }
        return null;
      })
    );

    const hit = hits.find(Boolean);
    if (hit) {
      return String(hit);
    }
  }

  return String(searchRefId);
}

async function resolvePrimaryRefId(searchRefId) {
  const fbo = await lookupRegistration(searchRefId);
  if (fbo.apptypeDesc !== "Renewal") {
    return {
      refId: String(fbo.refId || searchRefId),
      fbo,
    };
  }

  const suffixRefIdsByDigit = await buildSuffixRefIdMap(fbo.certificateNo.slice(0, 13));
  const refId = await findOriginalRegistrationRefId(
    searchRefId,
    fbo,
    suffixRefIdsByDigit
  );

  return { refId, fbo };
}

async function finalizeMatch(match) {
  if (match.apptype === "L") {
    return {
      refId: match.refId,
      record: match.record,
      registrationNumber: match.certificateNumber,
      apptype: match.apptype,
      licenseCategoryId: match.licenseCategoryId,
      companyName: match.companyName,
    };
  }

  const { refId, fbo } = await resolvePrimaryRefId(match.refId);
  return {
    refId,
    record: match.record,
    registrationNumber: fbo.certificateNo || match.certificateNumber,
    apptype: match.apptype,
    licenseCategoryId: null,
    companyName: fbo.companyName || match.companyName,
  };
}

async function finalizeLicenseMatch(match) {
  return {
    refId: match.refId,
    record: match.record,
    registrationNumber: match.certificateNumber,
    apptype: "L",
    licenseCategoryId: match.licenseCategoryId,
    companyName: match.companyName,
  };
}

async function searchThirteenDigitCertificate(prefix13, preferApptype = "R") {
  const searchFn = preferApptype === "L" ? searchLicenseOnly : searchCertificateAll;
  const matches = (
    await Promise.all(
      Array.from({ length: 10 }, async (_, digit) => {
        const certificateNumber = `${prefix13}${digit}`;
        const results = await searchFn(certificateNumber);
        return results.map((match) => ({
          ...match,
          digit,
          searchedAs: certificateNumber,
        }));
      })
    )
  ).flat();

  if (matches.length === 0) {
    const label = preferApptype === "L" ? "license" : "registration or license";
    throw new Error(
      `No ${label} found for: ${prefix13}. Provide the full 14-digit certificate number or refId.`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `${matches.length} matches found for 13-digit prefix. Use the full 14-digit certificate number or refId.`
    );
  }

  return preferApptype === "L"
    ? finalizeLicenseMatch(matches[0])
    : finalizeMatch(matches[0]);
}

async function searchRefIdWithVariants(registrationNumber, preferApptype = "R") {
  const digits = parseCertificateDigits(registrationNumber);

  if (digits.length === 13) {
    return searchThirteenDigitCertificate(digits, preferApptype);
  }

  const matches =
    preferApptype === "L"
      ? await searchLicenseOnly(digits)
      : await searchCertificateAll(digits, preferApptype);

  if (matches.length === 0) {
    const label = preferApptype === "L" ? "license" : "registration or license";
    throw new Error(`No ${label} found for: ${registrationNumber}`);
  }

  if (matches.length > 1) {
    throw new Error(
      `${matches.length} matches found. Use the correct refId from the search results.`
    );
  }

  return preferApptype === "L"
    ? finalizeLicenseMatch(matches[0])
    : finalizeMatch(matches[0]);
}

async function resolveRefId(input, preferApptype = "R") {
  const trimmed = input.trim();

  if (looksLikeRefId(trimmed)) {
    return {
      refId: trimmed,
      record: null,
      apptype: preferApptype === "L" ? "L" : null,
      licenseCategoryId: preferApptype === "L" ? 2 : null,
      registrationNumber: trimmed,
      companyName: "",
    };
  }

  return searchRefIdWithVariants(trimmed, preferApptype);
}

function ensureFssaiCredentials() {
  const creds = getCredentials();
  if (!creds.bearerToken || !creds.xAuthUserId) {
    return {
      ok: false,
      authExpired: true,
      error: "FSSAI bearer token or x-auth-user-id is not set. Paste credentials in the app.",
    };
  }

  const health = getTokenExpiryWarning();
  if (health.expired) {
    return {
      ok: false,
      authExpired: true,
      error: health.message || "FSSAI bearer token has expired",
    };
  }

  return { ok: true };
}

function buildFilename(type, label, refId) {
  const safeLabel = String(label).replace(/[^\dA-Za-z-]/g, "");
  return `${type}-${safeLabel}-${refId}.pdf`;
}

async function retryAfterAuthRefresh(result, retryFn) {
  if (!result.authExpired || !env.authRefreshOn401) {
    return result;
  }

  if (!isAutoRefreshConfigured()) {
    return result;
  }

  try {
    await refreshFssaiAuth(true);
    return retryFn();
  } catch (err) {
    return {
      authExpired: true,
      error: `Auth refresh failed: ${err.message}`,
    };
  }
}

async function downloadLicenseWithCategories(refId, licenseCategoryId) {
  const normalizedCategoryId = normalizeLicenseCategoryId(licenseCategoryId);
  const categoryIds = normalizedCategoryId
    ? [
        normalizedCategoryId,
        ...LICENSE_CATEGORY_IDS.filter((id) => id !== normalizedCategoryId),
      ]
    : LICENSE_CATEGORY_IDS;

  for (const categoryId of categoryIds) {
    let result = await downloadLicensePdfBuffer(refId, categoryId);

    if (result.authExpired) {
      result = await retryAfterAuthRefresh(result, () =>
        downloadLicensePdfBuffer(refId, categoryId)
      );
      if (result.authExpired) {
        return result;
      }
    }

    if (result.pdfBuffer && result.pdfBuffer.length > 0) {
      return { ...result, categoryId };
    }
  }

  return { error: "License PDF not found for any category", refId };
}

async function downloadRegistrationPdf(number) {
  const authCheck = ensureFssaiCredentials();
  if (!authCheck.ok) {
    return authCheck;
  }

  let search;
  try {
    search = await resolveRefId(number, "R");
  } catch (err) {
    return { error: err.message, notFound: true };
  }

  if (search.apptype === "L") {
    return {
      error: "Certificate is a license, not a registration. Use the License tab.",
      notFound: true,
    };
  }

  const refId = search.refId;
  let result = await downloadRegistrationPdfBuffer(refId);

  if (result.authExpired) {
    result = await retryAfterAuthRefresh(result, () =>
      downloadRegistrationPdfBuffer(refId)
    );
  }

  if (result.authExpired) {
    return { authExpired: true, error: result.error };
  }

  if (result.error || !result.pdfBuffer) {
    return { error: result.error || "PDF download failed" };
  }

  return {
    pdfBuffer: result.pdfBuffer,
    filename: buildFilename("registration", number, refId),
    refId,
    companyName: search.companyName,
    sizeBytes: result.sizeBytes,
  };
}

async function downloadLicensePdf(number) {
  const authCheck = ensureFssaiCredentials();
  if (!authCheck.ok) {
    return authCheck;
  }

  let search;
  try {
    search = await resolveRefId(number, "L");
  } catch (err) {
    return { error: err.message, notFound: true };
  }

  if (search.apptype && search.apptype !== "L") {
    return {
      error: "Certificate is a registration, not a license. Use the Registration tab.",
      notFound: true,
    };
  }

  const refId = search.refId;
  const result = await downloadLicenseWithCategories(refId, search.licenseCategoryId);

  if (result.authExpired) {
    return { authExpired: true, error: result.error };
  }

  if (result.error || !result.pdfBuffer) {
    return { error: result.error || "License PDF download failed" };
  }

  return {
    pdfBuffer: result.pdfBuffer,
    filename: buildFilename("license", number, refId),
    refId,
    companyName: search.companyName,
    sizeBytes: result.sizeBytes,
  };
}

module.exports = {
  downloadRegistrationPdf,
  downloadLicensePdf,
};
