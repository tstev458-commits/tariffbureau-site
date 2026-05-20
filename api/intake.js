// api/intake.js
// M1 + M2: Intake endpoint for Tariff Bureau
// M1 — Validates 6 sections, logs structured JSON, returns 200 OK
// M2 — Sends 3 DocuSign envelopes (NDA, Engagement Letter, Terms of Service)
//      via JWT Grant authentication, in parallel (Promise.all)
//
// Client-facing template fields are auto-populated via textTabs.
// Field naming convention (must match Data Label in DocuSign template):
//   Client Legal Entity Name, Client Address, Client City State Zip,
//   Client Country, Client Legal Email, Client Signatory Name, Client Title,
//   Client IOR or EIN, Service Tier, Engagement Date, Engagement Start Date
//
// Security: RSA private key is read from process.env.DOCUSIGN_PRIVATE_KEY
// in production (set in Vercel env vars). Local dev falls back to
// docusign-private.key file in project root (gitignored).
//
// Clean production logging:
//   [INTAKE_SUBMISSION]       — full form submission payload
//   [DOCUSIGN_ENVELOPE_REQUEST] — exact JSON sent to DocuSign for each envelope
//   [DOCUSIGN_ENVELOPES_SENT] — envelope IDs returned (success)
//   [DOCUSIGN_ERROR]          — exact DocuSign error response (failure)
//
// Phased testing supported via TEST_ONLY env var:
//   TEST_ONLY=nda          → only NDA
//   TEST_ONLY=terms        → only Terms
//   TEST_ONLY=engagement   → only Engagement
//   (unset)                → all 3 in parallel (production)

const docusign = require("docusign-esign");
const fs = require("fs");
const path = require("path");

// =====================================================
// HANDLER
// =====================================================
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const formData = req.body;

    const validation = validateIntakeForm(formData);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.errors,
      });
    }

    const submissionId = generateSubmissionId();
    const timestamp = new Date().toISOString();

    const logPayload = buildLogPayload(formData, submissionId, timestamp, req);
    console.log("[INTAKE_SUBMISSION]", JSON.stringify(logPayload, null, 2));

    let docusignResult;
    try {
      docusignResult = await sendDocuSignEnvelopes(formData);

      console.log(
        "[DOCUSIGN_ENVELOPES_SENT]",
        JSON.stringify(
          {
            submissionId,
            timestamp: new Date().toISOString(),
            sentTo: formData.legal_email,
            envelopes: {
              nda: docusignResult.ndaEnvelopeId,
              engagement: docusignResult.engagementEnvelopeId,
              terms: docusignResult.termsEnvelopeId,
            },
          },
          null,
          2,
        ),
      );
    } catch (docusignError) {
      console.error(
        "[DOCUSIGN_ERROR]",
        JSON.stringify(
          {
            message: docusignError.message,
            response: docusignError.response?.data || null,
            status: docusignError.response?.status || null,
          },
          null,
          2,
        ),
      );

      return res.status(500).json({
        error: "Submission received. Our team will follow up.",
      });
    }

    return res.status(200).json({
      success: true,
      submissionId,
      message:
        "Submission received. Our team will follow up within one business day.",
      timestamp,
      envelopes: {
        nda: docusignResult.ndaEnvelopeId,
        engagement: docusignResult.engagementEnvelopeId,
        terms: docusignResult.termsEnvelopeId,
      },
    });
  } catch (error) {
    console.error("[INTAKE_ERROR]", error.message);
    return res.status(500).json({
      error: "Submission received. Our team will follow up.",
    });
  }
};

// =====================================================
// M2 — DOCUSIGN INTEGRATION
// =====================================================

/**
 * Load the RSA private key for JWT signing.
 * Priority:
 *   1. process.env.DOCUSIGN_PRIVATE_KEY (production — Vercel env var)
 *   2. docusign-private.key file in project root (local dev fallback)
 *
 * The env var may contain escaped \n sequences (from .env file storage)
 * which must be converted to actual newlines for the RSA parser.
 */
function loadDocuSignPrivateKey() {
  if (process.env.DOCUSIGN_PRIVATE_KEY) {
    // Env var path — convert literal \n to real newlines if needed
    return process.env.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  // Local dev fallback — read file from project root
  const privateKeyPath = path.resolve(process.cwd(), "docusign-private.key");
  return fs.readFileSync(privateKeyPath, "utf8");
}

async function getDocuSignAccessToken() {
  const dsApi = new docusign.ApiClient();
  dsApi.setOAuthBasePath(
    process.env.DOCUSIGN_OAUTH_BASE || "account-d.docusign.com",
  );

  const privateKey = loadDocuSignPrivateKey();

  const results = await dsApi.requestJWTUserToken(
    process.env.DOCUSIGN_INTEGRATION_KEY,
    process.env.DOCUSIGN_USER_ID,
    ["signature", "impersonation"],
    privateKey,
    60 * 60,
  );

  const userInfo = await dsApi.getUserInfo(results.body.access_token);
  const envAccountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const matched = (userInfo.accounts || []).find(
    (a) => a.accountId === envAccountId,
  );

  if (!matched) {
    throw new Error(
      `DOCUSIGN_ACCOUNT_ID '${envAccountId}' not accessible by authenticated user.`,
    );
  }

  return {
    accessToken: results.body.access_token,
    accountId: matched.accountId,
  };
}

/**
 * Build textTabs array from form data — matching Data Labels configured
 * in DocuSign templates. Empty/null values are skipped so DocuSign keeps
 * the field editable with no pre-fill.
 */
function buildClientTextTabs(formData) {
  const submissionDate = formatSubmissionDate();

  const fields = [
    {
      tabLabel: "Client Legal Entity Name",
      value: formData.company_name || formData.company,
    },
    {
      tabLabel: "Client Address",
      value: formData.address_street || formData.street,
    },
    { tabLabel: "Client City State Zip", value: buildCityStateZip(formData) },
    {
      tabLabel: "Client Country",
      value: formData.address_country || formData.country || "US",
    },
    { tabLabel: "Client Legal Email", value: formData.legal_email },
    { tabLabel: "Client Signatory Name", value: formData.name },
    { tabLabel: "Client Title", value: formData.role || formData.title },
    { tabLabel: "Client IOR or EIN", value: formData.ein },
    {
      tabLabel: "Service Tier",
      value: getServiceName(formData.service_selection),
    },
    { tabLabel: "Engagement Date", value: submissionDate },
    { tabLabel: "Engagement Start Date", value: submissionDate },
  ];

  return fields
    .filter((f) => f.value && String(f.value).trim().length > 0)
    .map((f) => ({ tabLabel: f.tabLabel, value: String(f.value).trim() }));
}

function formatSubmissionDate() {
  const now = new Date();
  // Format: "May 19, 2026"
  return now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildCityStateZip(formData) {
  const city = formData.address_city || formData.city;
  const state = formData.address_state || formData.state;
  const zip = formData.address_zip || formData.zip;
  const parts = [city, state, zip].filter(
    (p) => p && String(p).trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

async function sendDocuSignEnvelopes(formData) {
  const { accessToken, accountId } = await getDocuSignAccessToken();

  const dsApi = new docusign.ApiClient();
  dsApi.setBasePath(`${process.env.DOCUSIGN_BASE_URL}/restapi`);
  dsApi.addDefaultHeader("Authorization", `Bearer ${accessToken}`);

  const envelopesApi = new docusign.EnvelopesApi(dsApi);
  const signerName = formData.name || formData.company_name || "Client";
  const signerEmail = formData.legal_email;
  const clientTextTabs = buildClientTextTabs(formData);

  const testOnly = process.env.TEST_ONLY;

  // ─── Phased testing ───
  if (testOnly === "nda") {
    const r = await sendEnvelope(
      envelopesApi,
      accountId,
      process.env.DOCUSIGN_TEMPLATE_NDA || '1480f06b-139e-4c05-ba7a-ca8a592d0f1f',
      "Mutual NDA — The Tariff Bureau",
      signerName,
      signerEmail,
      dsApi,
      clientTextTabs,
    );
    return {
      ndaEnvelopeId: r.envelopeId,
      engagementEnvelopeId: "skipped",
      termsEnvelopeId: "skipped",
    };
  }
  if (testOnly === "terms") {
    const r = await sendEnvelope(
      envelopesApi,
      accountId,
      process.env.DOCUSIGN_TEMPLATE_TERMS || '1fa9adf3-dc3a-48fd-8cc7-4246eebaee2f',
      "Terms of Service — The Tariff Bureau",
      signerName,
      signerEmail,
      dsApi,
      clientTextTabs,
    );
    return {
      ndaEnvelopeId: "skipped",
      engagementEnvelopeId: "skipped",
      termsEnvelopeId: r.envelopeId,
    };
  }
  if (testOnly === "engagement") {
    const r = await sendEnvelope(
      envelopesApi,
      accountId,
      process.env.DOCUSIGN_TEMPLATE_ENGAGEMENT || '82c15303-6793-40f4-999f-b25a87a7220d',
      "Engagement Letter — The Tariff Bureau",
      signerName,
      signerEmail,
      dsApi,
      clientTextTabs,
    );
    return {
      ndaEnvelopeId: "skipped",
      engagementEnvelopeId: r.envelopeId,
      termsEnvelopeId: "skipped",
    };
  }

  // ─── Production: all 3 in parallel ───
  const [ndaResult, engagementResult, termsResult] = await Promise.all([
    sendEnvelope(
      envelopesApi,
      accountId,
      process.env.DOCUSIGN_TEMPLATE_NDA || '1480f06b-139e-4c05-ba7a-ca8a592d0f1f',
      "Mutual NDA — The Tariff Bureau",
      signerName,
      signerEmail,
      dsApi,
      clientTextTabs,
    ),
    sendEnvelope(
      envelopesApi,
      accountId,
      process.env.DOCUSIGN_TEMPLATE_ENGAGEMENT || '82c15303-6793-40f4-999f-b25a87a7220d',
      "Engagement Letter — The Tariff Bureau",
      signerName,
      signerEmail,
      dsApi,
      clientTextTabs,
    ),
    sendEnvelope(
      envelopesApi,
      accountId,
      process.env.DOCUSIGN_TEMPLATE_TERMS || '1fa9adf3-dc3a-48fd-8cc7-4246eebaee2f',
      "Terms of Service — The Tariff Bureau",
      signerName,
      signerEmail,
      dsApi,
      clientTextTabs,
    ),
  ]);

  return {
    ndaEnvelopeId: ndaResult.envelopeId,
    engagementEnvelopeId: engagementResult.envelopeId,
    termsEnvelopeId: termsResult.envelopeId,
  };
}

/**
 * Send a single envelope using a pre-built template.
 * Auto-detects template role structure (single-signer or multi-signer).
 * Populates client-facing template fields from form data via textTabs.
 */
async function sendEnvelope(
  envelopesApi,
  accountId,
  templateId,
  emailSubject,
  signerName,
  signerEmail,
  dsApi,
  clientTextTabs,
) {
  const templatesApi = new docusign.TemplatesApi(dsApi);
  const templateDetails = await templatesApi.get(accountId, templateId);
  const signers = templateDetails.recipients?.signers || [];

  if (signers.length === 0) {
    throw new Error(
      `Template '${templateDetails.name}' (${templateId}) has no signer roles.`,
    );
  }

  // Build template roles — client-facing role gets form data + textTabs.
  // Internal roles (Advisor) keep template defaults and receive no tabs.
  const templateRoles = signers.map((s) => {
    const roleName = (s.roleName || "").trim();
    const isClientRole = /client|signer|counterparty|recipient/i.test(roleName);

    if (isClientRole) {
      const role = {
        roleName,
        email: signerEmail,
        name: signerName,
      };
      if (clientTextTabs && clientTextTabs.length > 0) {
        role.tabs = { textTabs: clientTextTabs };
      }
      return role;
    }

    return {
      roleName,
      email: (s.email && s.email.trim()) || signerEmail,
      name: (s.name && s.name.trim()) || signerName,
    };
  });

  const envelopeDefinition = {
    templateId,
    emailSubject,
    status: "sent",
    templateRoles,
  };

  console.log(
    "[DOCUSIGN_ENVELOPE_REQUEST]",
    JSON.stringify(
      { templateName: templateDetails.name, request: envelopeDefinition },
      null,
      2,
    ),
  );

  const result = await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition,
  });

  return result;
}

// =====================================================
// M1 — LOG PAYLOAD BUILDER (6 sections)
// =====================================================
function buildLogPayload(formData, submissionId, timestamp, req) {
  return {
    submissionId,
    timestamp,
    section1_contact: {
      name: formData.name || null,
      role: formData.role || formData.title || null,
      phone: formData.phone || null,
    },
    section2_legalEntity: {
      companyName: formData.company_name || formData.company || null,
      ein: formData.ein || null,
      address: {
        street: formData.address_street || formData.street || null,
        city: formData.address_city || formData.city || null,
        state: formData.address_state || formData.state || null,
        zip: formData.address_zip || formData.zip || null,
        country: formData.address_country || formData.country || "US",
      },
    },
    section3_emails: {
      legal: formData.legal_email || null,
      billing: formData.billing_email || null,
      technical: formData.technical_email || null,
    },
    section4_service: {
      serviceId: formData.service_selection || null,
      serviceName: getServiceName(formData.service_selection),
    },
    section5_consents: {
      nda: formData.consent_nda === true || formData.consent_nda === "true",
      engagement:
        formData.consent_engagement === true ||
        formData.consent_engagement === "true",
      terms:
        formData.consent_terms === true || formData.consent_terms === "true",
      consentTimestamp: timestamp,
    },
    section6_additional: {
      notes: formData.notes || formData.additional_details || null,
      source: formData.source || "intake_form_web",
      metadata: {
        userAgent: req.headers["user-agent"] || "unknown",
        ip:
          (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          "unknown",
        referrer: req.headers["referer"] || "unknown",
      },
    },
    idempotencyKey: `${formData.legal_email}_${Date.now()}`,
  };
}

// =====================================================
// HELPERS
// =====================================================

const VALID_SERVICES = {
  assessment: "Assessment Only",
  full_recovery: "Full Recovery Package",
  rerouting: "Rerouting Analysis",
  monitoring: "Monitoring Retainer",
  valuation: "Refund Claim Valuation Report",
  audit_optimization: "Claim Audit & Optimization",
};

function validateIntakeForm(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["No form data received"] };
  }

  const companyName = data.company_name || data.company;
  if (
    !companyName ||
    typeof companyName !== "string" ||
    companyName.trim().length === 0
  ) {
    errors.push("Company name is required");
  }

  if (!data.legal_email || !isValidEmail(data.legal_email)) {
    errors.push("Valid legal email address is required");
  }

  if (!data.service_selection) {
    errors.push("Service selection is required");
  } else if (!VALID_SERVICES.hasOwnProperty(data.service_selection)) {
    errors.push(
      `Service selection must be one of: ${Object.keys(VALID_SERVICES).join(", ")}`,
    );
  }

  if (data.consent_nda !== true && data.consent_nda !== "true") {
    errors.push("NDA consent is required");
  }
  if (data.consent_engagement !== true && data.consent_engagement !== "true") {
    errors.push("Engagement letter consent is required");
  }
  if (data.consent_terms !== true && data.consent_terms !== "true") {
    errors.push("Terms of service consent is required");
  }

  return { valid: errors.length === 0, errors };
}

function isValidEmail(email) {
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getServiceName(serviceId) {
  return VALID_SERVICES[serviceId] || null;
}

function generateSubmissionId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `INTAKE-${ts}-${rand}`;
}
