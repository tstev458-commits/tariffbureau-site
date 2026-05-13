// api/intake.js
// M1: Intake endpoint for Tariff Bureau
// Receives POST from intake form, validates 6 sections, logs structured JSON, returns 200 OK
// CommonJS pattern (matches existing api/chat.js)
// Field structure confirmed by client. M2 (DocuSign) and M3 (QuickBooks) will extend this.

module.exports = async function handler(req, res) {
  // CORS headers (same pattern as api/chat.js)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const formData = req.body;

    // Validate all M1 required fields
    const validation = validateIntakeForm(formData);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.errors,
      });
    }

    // Generate submission metadata
    const submissionId = generateSubmissionId();
    const timestamp = new Date().toISOString();

    // Build structured JSON payload with all 6 sections
    const logPayload = {
      submissionId,
      timestamp,

      // Section 1: Contact
      section1_contact: {
        name: formData.name || null,
        role: formData.role || formData.title || null,
        phone: formData.phone || null,
      },

      // Section 2: Legal Entity (EIN is optional)
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

      // Section 3: Email Addresses (legal_email required, others optional)
      section3_emails: {
        legal: formData.legal_email || null,
        billing: formData.billing_email || null,
        technical: formData.technical_email || null,
      },

      // Section 4: Service Selection
      section4_service: {
        serviceId: formData.service_selection || null,
        serviceName: getServiceName(formData.service_selection),
      },

      // Section 5: Consents (all 3 required)
      section5_consents: {
        nda: formData.consent_nda === true || formData.consent_nda === "true",
        engagement:
          formData.consent_engagement === true ||
          formData.consent_engagement === "true",
        terms:
          formData.consent_terms === true || formData.consent_terms === "true",
        consentTimestamp: timestamp,
      },

      // Section 6: Additional Info + Metadata
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

      // Idempotency key (prepared for M3 duplicate detection)
      idempotencyKey: `${formData.legal_email}_${Date.now()}`,
    };

    // Log structured JSON to Vercel console
    console.log("[INTAKE_SUBMISSION]", JSON.stringify(logPayload, null, 2));

    // Return 200 OK with confirmation payload
    return res.status(200).json({
      success: true,
      submissionId,
      message:
        "Submission received. Our team will follow up within one business day.",
      timestamp,
    });
  } catch (error) {
    // Log error server-side, never expose stack trace to client
    console.error("[INTAKE_ERROR]", error.message, error.stack);
    return res.status(500).json({
      error: "Submission received. Our team will follow up.",
    });
  }
};

// =====================================================
// HELPERS
// =====================================================

// Service options confirmed by client
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

  // Required: Company name
  const companyName = data.company_name || data.company;
  if (
    !companyName ||
    typeof companyName !== "string" ||
    companyName.trim().length === 0
  ) {
    errors.push("Company name is required");
  }

  // Required: Legal email (valid format)
  if (!data.legal_email || !isValidEmail(data.legal_email)) {
    errors.push("Valid legal email address is required");
  }

  // Required: Service selection (must be one of 6 known services)
  if (!data.service_selection) {
    errors.push("Service selection is required");
  } else if (!VALID_SERVICES.hasOwnProperty(data.service_selection)) {
    errors.push(
      `Service selection must be one of: ${Object.keys(VALID_SERVICES).join(", ")}`,
    );
  }

  // Required: 3 consents (all must be true)
  if (data.consent_nda !== true && data.consent_nda !== "true") {
    errors.push("NDA consent is required");
  }
  if (data.consent_engagement !== true && data.consent_engagement !== "true") {
    errors.push("Engagement letter consent is required");
  }
  if (data.consent_terms !== true && data.consent_terms !== "true") {
    errors.push("Terms of service consent is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
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
