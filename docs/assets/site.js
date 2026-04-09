(function () {
  function longToday() {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date());
  }

  function sanitizeFilename(value) {
    return String(value || 'Certificate')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Certificate';
  }

  function copyText(value) {
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(() => true, () => false);
    }
    try {
      const input = document.createElement('textarea');
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      return Promise.resolve(true);
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  function makeAbsoluteUrl(value) {
    try {
      return new URL(String(value || ''), window.location.href).href;
    } catch (error) {
      return String(value || '');
    }
  }


  function notifyWidgetHeight() {
    const widgetData = window.PUBLIC_GENERATOR_DATA;
    if (!widgetData || !widgetData.widgetMode || window.parent === window) return;
    const nextHeight = Math.ceil(Math.max(
      document.documentElement.scrollHeight || 0,
      document.body.scrollHeight || 0,
      document.documentElement.offsetHeight || 0,
      document.body.offsetHeight || 0
    ));
    window.parent.postMessage({
      type: 'csun-ebadge-widget-height',
      height: nextHeight
    }, '*');
  }

  function initializeWidgetAutoHeight() {
    const widgetData = window.PUBLIC_GENERATOR_DATA;
    if (!widgetData || !widgetData.widgetMode) return;
    notifyWidgetHeight();
    window.setTimeout(notifyWidgetHeight, 120);
    window.setTimeout(notifyWidgetHeight, 500);
    window.addEventListener('load', notifyWidgetHeight);
    window.addEventListener('resize', notifyWidgetHeight);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => notifyWidgetHeight()).catch(() => {});
    }
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => notifyWidgetHeight());
      observer.observe(document.body);
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
      image.src = src;
    });
  }

  function fitFontSize(ctx, text, field) {
    const minFontSize = 12;
    let size = Number(field.fontSize || 40);
    const maxWidth = Number(field.maxWidth || 0);
    while (size > minFontSize) {
      ctx.font = `${field.fontWeight || 'normal'} ${size}px ${field.fontFamily || 'Arial'}`;
      if (!maxWidth || ctx.measureText(text).width <= maxWidth) {
        break;
      }
      size -= 2;
    }
    return size;
  }

  function drawField(ctx, value, field) {
    const text = String(value || '').trim();
    if (!text) return;
    const fontSize = fitFontSize(ctx, text, field);
    ctx.save();
    ctx.fillStyle = field.color || '#000000';
    ctx.textAlign = field.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${field.fontWeight || 'normal'} ${fontSize}px ${field.fontFamily || 'Arial'}`;
    ctx.fillText(text, Number(field.x || 0), Number(field.y || 0));
    ctx.restore();
  }

  async function renderCertificateToCanvas(canvas, config, name, date) {
    const background = await loadImage(config.backgroundImage);
    canvas.width = background.width;
    canvas.height = background.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    drawField(ctx, name, config.name || {});
    drawField(ctx, date, config.date || {});
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height
    };
  }

  function downloadPdf(filename, imageData, width, height) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      window.alert('The PDF library did not load. Please refresh the page and try again.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: width >= height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [width, height]
    });
    pdf.addImage(imageData, 'PNG', 0, 0, width, height);
    pdf.save(filename);
  }


  function trackAnalytics(payload) {
    const body = JSON.stringify(payload || {});
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/track', blob);
      return Promise.resolve(true);
    }
    return fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).then(() => true, () => false);
  }

  async function fetchJson(source) {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to load ${source}`);
    }
    return response.json();
  }

  function resolveBadgeLink(badge) {
    return badge.relativeUrl || badge.publicUrl || '#';
  }

  function buildCredentialCard(badge) {
    const href = resolveBadgeLink(badge);
    return `
      <article class="credential-card">
        <div>
          <p class="section-label">${escapeHtml(badge.badgeTitle || '')}</p>
          <h3>${escapeHtml(badge.awardeeName || '')}</h3>
          <div class="credential-card__meta">
            <span><strong>Credential ID:</strong> ${escapeHtml(badge.id || '')}</span>
            <span><strong>Issued:</strong> ${escapeHtml(badge.issueDate || '')}</span>
            <span><strong>Status:</strong> ${escapeHtml((badge.status || 'valid').toUpperCase())}</span>
          </div>
        </div>
        <div class="credential-card__actions">
          <a class="button-link button-link--secondary" href="${escapeAttribute(href)}">View badge</a>
        </div>
      </article>`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  async function initializeCertificateBuilder() {
    const form = document.getElementById('certificateForm');
    if (!form) return;

    const inputName = document.getElementById('inputName');
    const inputDate = document.getElementById('inputDate');
    const buttonGenerate = document.getElementById('btnGenerate');
    const buttonDownload = document.getElementById('btnDownload');
    const status = document.getElementById('statusMessage');
    const canvas = document.getElementById('certCanvas');
    const image = document.getElementById('certImage');
    let lastRender = null;

    if (inputDate && !inputDate.value) {
      inputDate.value = longToday();
    }

    let config;
    try {
      config = await fetchJson(form.getAttribute('data-config-source'));
    } catch (error) {
      if (status) {
        status.textContent = error.message;
      }
      return;
    }

    async function generate() {
      if (!inputName.value.trim()) {
        status.textContent = 'Please enter a full name.';
        return;
      }
      if (!inputDate.value.trim()) {
        inputDate.value = longToday();
      }
      status.textContent = 'Generating certificate preview...';
      buttonGenerate.disabled = true;
      try {
        lastRender = await renderCertificateToCanvas(canvas, config, inputName.value.trim(), inputDate.value.trim());
        image.src = lastRender.dataUrl;
        image.style.display = 'block';
        buttonDownload.style.display = 'inline-flex';
        status.textContent = 'Certificate ready. Download the PDF when you are ready.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        buttonGenerate.disabled = false;
      }
    }

    buttonGenerate.addEventListener('click', generate);
    buttonDownload.addEventListener('click', async () => {
      if (!lastRender) {
        await generate();
      }
      if (!lastRender) return;
      const suffix = config.fileNameSuffix || '_Certificate';
      const filename = `${sanitizeFilename(inputName.value.trim())}${suffix}.pdf`;
      downloadPdf(filename, lastRender.dataUrl, lastRender.width, lastRender.height);
    });
  }

  async function initializeBadgeCertificate() {
    if (!window.BADGE_PAGE_DATA || !window.CERTIFICATE_TEMPLATE) return;

    const previewImage = document.getElementById('badgeCertImage');
    const canvas = document.getElementById('badgeCertCanvas');
    const button = document.getElementById('btnDownloadBadgeCertificate');
    if (!previewImage || !canvas || !button) return;

    let render;
    const name = window.BADGE_PAGE_DATA.awardeeName;
    const date = window.BADGE_PAGE_DATA.issueDate || longToday();

    async function ensureRender() {
      if (render) return render;
      render = await renderCertificateToCanvas(canvas, window.CERTIFICATE_TEMPLATE, name, date);
      previewImage.src = render.dataUrl;
      previewImage.style.display = 'block';
      return render;
    }

    try {
      await ensureRender();
      trackAnalytics({
        type: 'badge_viewed',
        badgeId: window.BADGE_PAGE_DATA.id,
        badgeSlug: window.BADGE_PAGE_DATA.slug,
        badgeTitle: window.BADGE_PAGE_DATA.badgeTitle,
        badgeTemplateId: window.BADGE_PAGE_DATA.badgeTemplateId,
        awardeeName: window.BADGE_PAGE_DATA.awardeeName,
        publicUrl: window.location.href,
        source: 'badge-page',
        context: 'public-badge-page'
      });
    } catch (error) {
      button.disabled = true;
      button.textContent = 'Certificate unavailable';
      console.error(error);
      return;
    }

    button.addEventListener('click', async () => {
      const currentRender = await ensureRender();
      const suffix = window.CERTIFICATE_TEMPLATE.fileNameSuffix || window.BADGE_PAGE_DATA.fileNameSuffix || '_Certificate';
      const filename = `${sanitizeFilename(name)}${suffix}.pdf`;
      downloadPdf(filename, currentRender.dataUrl, currentRender.width, currentRender.height);
      trackAnalytics({
        type: 'certificate_downloaded',
        badgeId: window.BADGE_PAGE_DATA.id,
        badgeSlug: window.BADGE_PAGE_DATA.slug,
        badgeTitle: window.BADGE_PAGE_DATA.badgeTitle,
        badgeTemplateId: window.BADGE_PAGE_DATA.badgeTemplateId,
        awardeeName: window.BADGE_PAGE_DATA.awardeeName,
        publicUrl: window.location.href,
        source: 'badge-page',
        context: 'badge-certificate-download'
      });
    });
  }

  async function initializePublicGenerator() {
    const form = document.getElementById('publicGeneratorForm');
    if (!form || !window.PUBLIC_GENERATOR_DATA) return;

    const data = window.PUBLIC_GENERATOR_DATA;
    const templates = Array.isArray(data.templates) ? data.templates : [];
    const baseCertificateTemplate = data.certificateTemplate || {};
    const fixedTemplateId = String(data.fixedTemplateId || '').trim();

    const nameInput = document.getElementById('publicGeneratorName');
    const dateInput = document.getElementById('publicGeneratorDate');
    const templateSelect = document.getElementById('publicGeneratorTemplate');
    const previewButton = document.getElementById('publicPreviewButton');
    const createButton = document.getElementById('publicCreateButton');
    const status = document.getElementById('publicGeneratorStatus');
    const canvas = document.getElementById('publicGeneratorCanvas');
    const previewImage = document.getElementById('publicGeneratorImage');
    const previewEmpty = document.getElementById('publicGeneratorPreviewEmpty');

    const templateTitle = document.getElementById('generatorTemplateTitle');
    const templateDescription = document.getElementById('generatorTemplateDescription');
    const templateMeaning = document.getElementById('generatorTemplateMeaning');
    const templateIssuer = document.getElementById('generatorTemplateIssuer');
    const templateCareerCenter = document.getElementById('generatorTemplateCareerCenter');
    const templateImage = document.getElementById('generatorTemplateImage');
    const templateImageEmpty = document.getElementById('generatorTemplateImageEmpty');

    const resultCard = document.getElementById('generatorResultCard');
    const resultName = document.getElementById('generatorResultName');
    const resultBadge = document.getElementById('generatorResultBadge');
    const resultDate = document.getElementById('generatorResultDate');
    const resultId = document.getElementById('generatorResultId');
    const resultUrl = document.getElementById('generatorResultUrl');
    const openBadge = document.getElementById('generatorOpenBadge');
    const copyBadge = document.getElementById('generatorCopyBadge');
    const downloadButton = document.getElementById('generatorDownloadPdf');

    let lastRender = null;
    let lastIssuedBadge = null;

    if (dateInput && !dateInput.value) {
      dateInput.value = longToday();
    }


    if (fixedTemplateId && templateSelect) {
      const fixedTemplate = templates.find((item) => item.id === fixedTemplateId);
      if (fixedTemplate) {
        templateSelect.value = fixedTemplate.id;
        templateSelect.setAttribute('disabled', 'disabled');
      }
    }

    const generatorLayout = form.closest('.generator-layout');

    function getSelectedTemplate() {
      return templates.find((template) => template.id === templateSelect.value) || null;
    }

    function applyWidgetLayout(selected) {
      if (!data.widgetMode || !generatorLayout) return;
      generatorLayout.classList.remove('generator-layout--widget-split', 'generator-layout--widget-stacked');
      const layout = selected && selected.widgetLayout === 'stacked' ? 'stacked' : 'split';
      generatorLayout.classList.add('generator-layout--widget-' + layout);
      notifyWidgetHeight();
    }

    function activeCertificateTemplate() {
      const selected = getSelectedTemplate();
      if (selected && selected.certificateTemplate) {
        return {
          ...baseCertificateTemplate,
          ...selected.certificateTemplate,
          backgroundImage: (selected.certificateTemplate && selected.certificateTemplate.backgroundImage) || selected.certificateBackground || baseCertificateTemplate.backgroundImage
        };
      }
      return {
        ...baseCertificateTemplate,
        backgroundImage: (selected && selected.certificateBackground) || baseCertificateTemplate.backgroundImage
      };
    }

    function updateTemplatePanel() {
      const selected = getSelectedTemplate();
      if (!selected) {
        templateTitle.textContent = 'Choose a badge type';
        templateDescription.textContent = 'Once you pick a badge template, the formal badge meaning, issuer, and badge image appear here.';
        templateMeaning.textContent = 'Select a badge template to view the official badge meaning.';
        templateIssuer.textContent = 'Issuer details will appear here.';
        templateCareerCenter.textContent = 'Career Center link will appear here.';
        templateImage.style.display = 'none';
        templateImage.removeAttribute('src');
        if (templateImageEmpty) templateImageEmpty.style.display = 'block';
        applyWidgetLayout(null);
        return;
      }

      templateTitle.textContent = selected.title || 'Selected badge';
      templateDescription.textContent = selected.description || selected.meaning || 'Formal badge description.';
      templateMeaning.textContent = selected.publicSummary || selected.description || selected.meaning || 'No badge meaning has been configured for this template yet.';
      templateIssuer.textContent = [selected.issuerName, selected.issuerOrganization].filter(Boolean).join(' · ') || 'Issuer details unavailable.';
      templateCareerCenter.innerHTML = selected.careerCenterUrl
        ? `<a class="text-link" href="${escapeAttribute(selected.careerCenterUrl)}" target="_blank" rel="noreferrer">${escapeHtml(selected.careerCenterUrl)}</a>`
        : 'Career Center link unavailable.';

      applyWidgetLayout(selected);

      if (selected.badgeImage) {
        templateImage.src = selected.badgeImage;
        templateImage.style.display = 'block';
        if (templateImageEmpty) templateImageEmpty.style.display = 'none';
      } else {
        templateImage.style.display = 'none';
        if (templateImageEmpty) templateImageEmpty.style.display = 'block';
      }
    }

    async function ensurePreview() {
      const name = String(nameInput.value || '').trim();
      const selected = getSelectedTemplate();

      if (!name) {
        status.textContent = 'Please enter a recipient name.';
        return null;
      }
      if (!selected) {
        status.textContent = 'Please choose a badge type.';
        return null;
      }
      if (!dateInput.value.trim()) {
        dateInput.value = longToday();
      }

      status.textContent = 'Generating certificate preview...';
      previewButton.disabled = true;
      createButton.disabled = true;
      try {
        lastRender = await renderCertificateToCanvas(canvas, activeCertificateTemplate(), name, dateInput.value.trim());
        previewImage.src = lastRender.dataUrl;
        previewImage.style.display = 'block';
        if (previewEmpty) {
          previewEmpty.style.display = 'none';
        }
        status.textContent = 'Preview ready. Create the badge when you are ready.';
        notifyWidgetHeight();
        return lastRender;
      } catch (error) {
        status.textContent = error.message;
        return null;
      } finally {
        previewButton.disabled = false;
        createButton.disabled = false;
      }
    }

    if (templateSelect) {
      templateSelect.addEventListener('change', () => {
        updateTemplatePanel();
        lastRender = null;
        lastIssuedBadge = null;
        if (resultCard) resultCard.hidden = true;
        if (previewImage) previewImage.style.display = 'none';
        if (previewEmpty) previewEmpty.style.display = 'block';
      });
    }

    previewButton.addEventListener('click', async () => {
      await ensurePreview();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const selected = getSelectedTemplate();
      const preview = await ensurePreview();
      if (!preview || !selected) {
        return;
      }

      createButton.disabled = true;
      previewButton.disabled = true;
      status.textContent = 'Creating the public badge page and updating the registry...';

      try {
        const response = await fetch(data.submitEndpoint || '/api/public/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            awardeeName: nameInput.value.trim(),
            issueDate: dateInput.value.trim(),
            badgeTemplateId: selected.id,
            pageKind: data.pageKind || (fixedTemplateId ? 'specific' : 'general'),
            generatorLabel: data.widgetMode ? (fixedTemplateId ? `${selected.title} widget` : 'General widget') : (fixedTemplateId ? `${selected.title} generator` : 'General generator')
          })
        });

        let payload = {};
        try {
          payload = await response.json();
        } catch (error) {
          payload = {};
        }

        if (!response.ok || !payload.ok || !payload.badge) {
          throw new Error(payload.error || 'The badge could not be created.');
        }

        lastIssuedBadge = payload.badge;
        const publicUrl = makeAbsoluteUrl(payload.badge.publicUrl);

        if (resultCard) resultCard.hidden = false;
        if (resultName) resultName.textContent = payload.badge.awardeeName || nameInput.value.trim();
        if (resultBadge) resultBadge.textContent = payload.badge.badgeTitle || selected.title || '';
        if (resultDate) resultDate.textContent = payload.badge.issueDate || dateInput.value.trim();
        if (resultId) resultId.textContent = payload.badge.id || '';
        if (resultUrl) {
          resultUrl.href = publicUrl;
          resultUrl.textContent = publicUrl;
        }
        if (openBadge) {
          openBadge.href = publicUrl;
        }
        if (resultCard) {
          window.requestAnimationFrame(() => {
            resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }

        status.textContent = 'Badge created successfully. The public verification link is ready and the admin dashboard can now find this record.';
        document.body.classList.add('generator-has-result');
        notifyWidgetHeight();
      } catch (error) {
        const message = /Failed to fetch/i.test(error.message)
          ? 'The generator could not reach the badge server. Start the Node app or host this project on a Node-capable service so the public form can write new badge files.'
          : error.message;
        status.textContent = message;
      } finally {
        createButton.disabled = false;
        previewButton.disabled = false;
      }
    });

    if (copyBadge) {
      copyBadge.addEventListener('click', async () => {
        const value = resultUrl && resultUrl.href ? resultUrl.href : '';
        const ok = await copyText(value);
        if (!ok) return;
        const original = copyBadge.textContent;
        copyBadge.textContent = 'Copied';
        window.setTimeout(() => {
          copyBadge.textContent = original;
        }, 1400);
      });
    }

    if (downloadButton) {
      downloadButton.addEventListener('click', async () => {
        const preview = lastRender || (await ensurePreview());
        if (!preview) return;
        const suffix = activeCertificateTemplate().fileNameSuffix || '_Certificate';
        const filename = `${sanitizeFilename(nameInput.value.trim())}${suffix}.pdf`;
        downloadPdf(filename, preview.dataUrl, preview.width, preview.height);
        const selected = getSelectedTemplate();
        trackAnalytics({
          type: 'certificate_downloaded',
          badgeId: lastIssuedBadge ? lastIssuedBadge.id : '',
          badgeSlug: lastIssuedBadge ? lastIssuedBadge.slug : '',
          badgeTitle: lastIssuedBadge ? lastIssuedBadge.badgeTitle : (selected ? selected.title : ''),
          badgeTemplateId: selected ? selected.id : '',
          awardeeName: nameInput.value.trim(),
          publicUrl: lastIssuedBadge ? makeAbsoluteUrl(lastIssuedBadge.publicUrl) : window.location.href,
          source: 'generator-page',
          pageKind: data.pageKind || (fixedTemplateId ? 'specific' : 'general'),
          context: 'generator-certificate-download'
        });
      });
    }

    updateTemplatePanel();
    initializeWidgetAutoHeight();
    notifyWidgetHeight();

    const initialTemplate = getSelectedTemplate();
    trackAnalytics({
      type: 'generator_opened',
      badgeTemplateId: initialTemplate ? initialTemplate.id : '',
      badgeTitle: initialTemplate ? initialTemplate.title : '',
      generatorKey: fixedTemplateId || 'general',
      generatorLabel: data.widgetMode ? (fixedTemplateId && initialTemplate ? `${initialTemplate.title} widget` : 'General widget') : (fixedTemplateId && initialTemplate ? `${initialTemplate.title} generator` : 'General generator'),
      pageKind: data.pageKind || (fixedTemplateId ? 'specific' : 'general'),
      source: 'generator-page',
      context: 'generator-page-open'
    });
  }

  async function renderRecentBadges() {
    const container = document.getElementById('recentBadges');
    if (!container) return;
    try {
      const badges = await fetchJson(container.getAttribute('data-source'));
      if (!Array.isArray(badges) || !badges.length) {
        container.innerHTML = '<div class="empty-state">No badges have been published yet. Once you issue one from the admin dashboard or generator page, it will appear here automatically.</div>';
        return;
      }
      container.innerHTML = badges.slice(0, 6).map(buildCredentialCard).join('');
    } catch (error) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  async function initializeRegistrySearch() {
    const results = document.getElementById('registryResults');
    const form = document.getElementById('registryPageSearch');
    const input = document.getElementById('registrySearchInput');
    if (!results || !form || !input) return;

    let badges = [];
    try {
      badges = await fetchJson(results.getAttribute('data-source'));
    } catch (error) {
      results.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('q')) {
      input.value = params.get('q');
    }

    function matches(badge, query) {
      const haystack = [
        badge.awardeeName,
        badge.badgeTitle,
        badge.issueDate,
        badge.id,
        badge.status,
        badge.meaning
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query.toLowerCase());
    }

    function draw() {
      const query = input.value.trim();
      const filtered = query ? badges.filter((badge) => matches(badge, query)) : badges;
      if (!filtered.length) {
        results.innerHTML = '<div class="empty-state">No matching badges were found. Try a different recipient name, date, badge title, or credential ID.</div>';
        return;
      }
      results.innerHTML = filtered.map(buildCredentialCard).join('');
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const nextParams = new URLSearchParams(window.location.search);
      if (input.value.trim()) {
        nextParams.set('q', input.value.trim());
      } else {
        nextParams.delete('q');
      }
      const nextUrl = `${window.location.pathname}${nextParams.toString() ? `?${nextParams}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
      draw();
    });

    input.addEventListener('input', draw);
    draw();
  }

  function bindCopyButtons() {
    document.querySelectorAll('[data-copy-url], [data-copy-text]').forEach((button) => {
      button.addEventListener('click', async () => {
        const rawText = button.getAttribute('data-copy-text');
        const rawUrl = button.getAttribute('data-copy-url');
        const value = rawText != null
          ? rawText
          : (/^https?:/i.test(rawUrl || '') ? rawUrl : makeAbsoluteUrl(rawUrl || window.location.href));
        const ok = await copyText(value);
        if (!ok) return;
        const labelTarget = button.matches('button') ? button : button.querySelector('small') || button;
        const original = labelTarget.textContent;
        labelTarget.textContent = 'Copied';
        window.setTimeout(() => {
          labelTarget.textContent = original;
        }, 1400);
      });
    });
  }

  initializeCertificateBuilder();
  initializeBadgeCertificate();
  initializePublicGenerator();
  renderRecentBadges();
  initializeRegistrySearch();
  bindCopyButtons();
})();
