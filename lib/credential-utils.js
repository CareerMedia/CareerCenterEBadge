const crypto = require('crypto');

function parseListField(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEvidence(record = {}) {
  return {
    label: String(record.evidenceLabel || 'Evidence').trim() || 'Evidence',
    prompt: String(record.evidencePrompt || '').trim(),
    description: String(record.evidenceDescription || '').trim(),
    exampleUrl: String(record.evidenceExampleUrl || '').trim(),
    submissionUrl: String(record.evidenceUrl || '').trim(),
    submissionNote: String(record.evidenceText || '').trim()
  };
}

function normalizeIssuerTrust(record = {}, siteConfig = {}) {
  return {
    issuerTrustLabel: String(record.issuerTrustLabel || 'Official issuer').trim() || 'Official issuer',
    issuerVerificationNote: String(record.issuerVerificationNote || siteConfig.footerNote || '').trim(),
    issuerContactEmail: String(record.issuerContactEmail || siteConfig.supportEmail || '').trim(),
    issuerRegistryUrl: String(record.issuerRegistryUrl || '').trim(),
    issuerWebsite: String(record.issuerWebsite || '').trim(),
    careerCenterUrl: String(record.careerCenterUrl || siteConfig.defaultCareerCenterUrl || '').trim(),
    issuerName: String(record.issuerName || siteConfig.organizationName || '').trim(),
    issuerOrganization: String(record.issuerOrganization || siteConfig.organizationName || '').trim()
  };
}

function normalizePathway(record = {}) {
  return {
    pathwayId: String(record.pathwayId || '').trim(),
    pathwayTitle: String(record.pathwayTitle || '').trim(),
    pathwayDescription: String(record.pathwayDescription || '').trim(),
    pathwayOrder: Number(record.pathwayOrder || 1) || 1,
    pathwayItems: parseListField(record.pathwayItems)
  };
}

function buildVerificationHash(badge) {
  const payload = {
    id: badge.id,
    slug: badge.slug,
    awardeeName: badge.awardeeName,
    badgeTitle: badge.badgeTitle,
    issueDateISO: badge.issueDateISO,
    issuerName: badge.issuerName,
    badgeTemplateId: badge.badgeTemplateId,
    publicUrl: badge.publicUrl
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function badgeToOpenBadge(badge, siteConfig = {}) {
  const trust = normalizeIssuerTrust(badge, siteConfig);
  const evidence = normalizeEvidence(badge);
  const pathway = normalizePathway(badge);
  const skills = parseListField(badge.skills);
  const standards = parseListField(badge.standards);

  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'
    ],
    id: badge.publicUrl,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    name: badge.badgeTitle,
    description: badge.publicSummary || badge.description || badge.meaning,
    validFrom: badge.issueDateISO,
    issuer: {
      type: 'Profile',
      id: trust.issuerWebsite || trust.careerCenterUrl || siteConfig.defaultCareerCenterUrl,
      name: trust.issuerName,
      url: trust.issuerWebsite || trust.careerCenterUrl || siteConfig.defaultCareerCenterUrl,
      email: trust.issuerContactEmail,
      official: true,
      verificationNote: trust.issuerVerificationNote,
      registryUrl: trust.issuerRegistryUrl || undefined
    },
    credentialSubject: {
      type: ['AchievementSubject'],
      id: `urn:uuid:${badge.id}`,
      name: badge.awardeeName,
      achievement: {
        id: `${badge.publicUrl}#achievement`,
        type: 'Achievement',
        name: badge.badgeTitle,
        description: badge.publicSummary || badge.description || badge.meaning,
        criteria: {
          narrative: badge.criteria
        },
        image: badge.badgeImage,
        skills,
        standards,
        pathway,
        evidence,
        alignment: standards.map((label) => ({ targetName: label }))
      }
    },
    verificationHash: buildVerificationHash(badge)
  };
}

function badgeToVcJson(badge, siteConfig = {}) {
  const trust = normalizeIssuerTrust(badge, siteConfig);
  const evidence = normalizeEvidence(badge);
  const pathway = normalizePathway(badge);
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: badge.publicUrl,
    type: ['VerifiableCredential', 'EducationalOccupationalCredential'],
    issuer: {
      id: trust.issuerWebsite || trust.careerCenterUrl || siteConfig.defaultCareerCenterUrl,
      name: trust.issuerName,
      official: true,
      contactEmail: trust.issuerContactEmail,
      registryUrl: trust.issuerRegistryUrl || undefined
    },
    validFrom: badge.issueDateISO,
    credentialSubject: {
      id: `urn:uuid:${badge.id}`,
      name: badge.awardeeName,
      achievementTitle: badge.badgeTitle,
      publicSummary: badge.publicSummary || badge.description || badge.meaning,
      meaning: badge.meaning,
      criteria: badge.criteria,
      evidence,
      skills: parseListField(badge.skills),
      standards: parseListField(badge.standards),
      pathway
    },
    proof: {
      type: 'Sha256IntegrityProof',
      verificationMethod: badge.publicUrl,
      created: badge.createdAt,
      proofPurpose: 'assertionMethod',
      proofValue: buildVerificationHash(badge)
    }
  };
}

function buildGeneratorRoute(templateId, mode = 'generator') {
  if (!templateId) {
    return `/${mode}/`;
  }
  return `/${mode}/${encodeURIComponent(templateId)}/`;
}

function buildWidgetEmbedCode(baseUrl, templateId = '') {
  const cleanedBase = String(baseUrl || '').replace(/\/+$/, '');
  const src = templateId ? `${cleanedBase}/widget/${encodeURIComponent(templateId)}/` : `${cleanedBase}/widget/`;
  return `<iframe src="${src}" data-csun-ebadge-widget="true" style="width:100%;max-width:720px;border:0;overflow:hidden;background:transparent;" scrolling="no"></iframe>\n<script>(function(){function resize(event){if(!event.data||event.data.type!=='csun-ebadge-widget-height')return;document.querySelectorAll('iframe[data-csun-ebadge-widget="true"]').forEach(function(frame){if(frame.contentWindow===event.source){frame.style.height=Math.max(320,Number(event.data.height||0))+'px';}});}window.addEventListener('message',resize,false);})();</script>`;
}

module.exports = {
  parseListField,
  normalizeEvidence,
  normalizeIssuerTrust,
  normalizePathway,
  buildVerificationHash,
  badgeToOpenBadge,
  badgeToVcJson,
  buildWidgetEmbedCode,
  buildGeneratorRoute
};
