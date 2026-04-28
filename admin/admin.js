(function () {
  function copyText(value) {
    if (!value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement('textarea');
    input.value = value;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }

  function bindCopyButtons() {
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', () => {
        copyText(button.getAttribute('data-copy'));
        const original = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(() => {
          button.textContent = original;
        }, 1400);
      });
    });
  }

  function bindDeleteConfirms() {
    document.querySelectorAll('form[data-confirm]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        const message = form.getAttribute('data-confirm') || 'Are you sure?';
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      });
    });
  }

  function setFieldValue(field, value) {
    if (!field) return;
    field.value = value == null ? '' : value;
  }

  function listToText(value) {
    return Array.isArray(value) ? value.join('\n') : String(value || '');
  }

  function autoFillIssueForm() {
    const select = document.getElementById('badgeTemplateId');
    if (!select || !Array.isArray(window.__TEMPLATES__)) return;

    const fields = {
      badgeTitle: document.getElementById('badgeTitle'),
      badgeLabel: document.getElementById('badgeLabel'),
      publicSummary: document.getElementById('publicSummary'),
      meaning: document.getElementById('meaning'),
      criteria: document.getElementById('criteria'),
      issuerName: document.getElementById('issuerName'),
      issuerOrganization: document.getElementById('issuerOrganization'),
      issuerWebsite: document.getElementById('issuerWebsite'),
      issuerContactEmail: document.getElementById('issuerContactEmail'),
      issuerRegistryUrl: document.getElementById('issuerRegistryUrl'),
      issuerVerificationNote: document.getElementById('issuerVerificationNote'),
      careerCenterUrl: document.getElementById('careerCenterUrl'),
      badgeImage: document.getElementById('badgeImage'),
      certificateBackground: document.getElementById('certificateBackground'),
      skills: document.getElementById('skills'),
      standards: document.getElementById('standards'),
      pathwayTitle: document.getElementById('pathwayTitle'),
      pathwayOrder: document.getElementById('pathwayOrder'),
      pathwayItems: document.getElementById('pathwayItems'),
      evidenceUrl: document.getElementById('evidenceUrl'),
      evidenceText: document.getElementById('evidenceText')
    };

    select.addEventListener('change', () => {
      const template = window.__TEMPLATES__.find((item) => item.id === select.value);
      if (!template) return;
      setFieldValue(fields.badgeTitle, template.title || '');
      setFieldValue(fields.badgeLabel, template.badgeLabel || '');
      setFieldValue(fields.publicSummary, template.publicSummary || template.description || '');
      setFieldValue(fields.meaning, template.meaning || '');
      setFieldValue(fields.criteria, template.criteria || '');
      setFieldValue(fields.issuerName, template.issuerName || '');
      setFieldValue(fields.issuerOrganization, template.issuerOrganization || '');
      setFieldValue(fields.issuerWebsite, template.issuerWebsite || '');
      setFieldValue(fields.issuerContactEmail, template.issuerContactEmail || '');
      setFieldValue(fields.issuerRegistryUrl, template.issuerRegistryUrl || '');
      setFieldValue(fields.issuerVerificationNote, template.issuerVerificationNote || '');
      setFieldValue(fields.careerCenterUrl, template.careerCenterUrl || '');
      setFieldValue(fields.badgeImage, template.badgeImage || '');
      setFieldValue(fields.certificateBackground, template.certificateBackground || '');
      setFieldValue(fields.skills, listToText(template.skills));
      setFieldValue(fields.standards, listToText(template.standards));
      setFieldValue(fields.pathwayTitle, template.pathwayTitle || '');
      setFieldValue(fields.pathwayOrder, template.pathwayOrder || 1);
      setFieldValue(fields.pathwayItems, listToText(template.pathwayItems));
      if (fields.evidenceUrl && !fields.evidenceUrl.value) setFieldValue(fields.evidenceUrl, template.evidenceExampleUrl || '');
      if (fields.evidenceText && !fields.evidenceText.value) setFieldValue(fields.evidenceText, template.evidencePrompt || template.evidenceDescription || '');
    });
  }

  function bindFileLoaders() {
    document.querySelectorAll('[data-load-file]').forEach((input) => {
      input.addEventListener('change', async () => {
        const targetId = input.getAttribute('data-load-file');
        const target = targetId ? document.getElementById(targetId) : null;
        const file = input.files && input.files[0];
        if (!target || !file) return;
        const text = await file.text();
        target.value = text;
      });
    });
  }

  function bindUploadInputs() {
    document.querySelectorAll('[data-upload-target]').forEach((input) => {
      input.addEventListener('change', () => {
        const targetId = input.getAttribute('data-upload-target');
        const previewTargetId = input.getAttribute('data-preview-target');
        const target = targetId ? document.getElementById(targetId) : null;
        const previewTarget = previewTargetId ? document.getElementById(previewTargetId) : null;
        const file = input.files && input.files[0];
        if (!file || !target) return;
        const reader = new FileReader();
        reader.onload = () => {
          target.value = String(reader.result || '');
          if (previewTarget) {
            previewTarget.value = file.name;
            previewTarget.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const previewImage = document.getElementById('certificateCoordinateImage');
          if (previewImage && targetId === 'certificateBackgroundUploadDataUrl') {
            previewImage.src = String(reader.result || '');
          }
        };
        reader.readAsDataURL(file);
      });
    });
  }

  function bindCoordinateEditor() {
    const editor = document.getElementById('certificateCoordinatePreview');
    const image = document.getElementById('certificateCoordinateImage');
    if (!editor || !image) return;
    const nameX = document.getElementById('templateNameX');
    const nameY = document.getElementById('templateNameY');
    const dateX = document.getElementById('templateDateX');
    const dateY = document.getElementById('templateDateY');
    const nameFontSize = document.getElementById('templateNameFontSize');
    const dateFontSize = document.getElementById('templateDateFontSize');
    const nameMarker = editor.querySelector('[data-coordinate-target="name"]');
    const dateMarker = editor.querySelector('[data-coordinate-target="date"]');
    const nameDot = nameMarker && nameMarker.querySelector('.coordinate-dot');
    const dateDot = dateMarker && dateMarker.querySelector('.coordinate-dot');
    const namePreview = document.getElementById('coordinatePreviewName');
    const datePreview = document.getElementById('coordinatePreviewDate');
    const overrideToggle = document.getElementById('certificateTemplateOverrideEnabled');

    function syncEnabledState() {
      const enabled = !overrideToggle || overrideToggle.checked;
      editor.classList.toggle('coordinate-preview--disabled', !enabled);
      [nameDot, dateDot].forEach((dot) => {
        if (dot) dot.disabled = !enabled;
      });
    }

    function updatePreviewTypography() {
      const rect = image.getBoundingClientRect();
      const naturalWidth = image.naturalWidth || rect.width || 1;
      const scale = rect.width / naturalWidth;
      if (namePreview && nameFontSize) {
        const size = Math.max(12, Math.round(Number(nameFontSize.value || 48) * scale));
        namePreview.style.fontSize = `${size}px`;
      }
      if (datePreview && dateFontSize) {
        const size = Math.max(11, Math.round(Number(dateFontSize.value || 32) * scale));
        datePreview.style.fontSize = `${size}px`;
      }
    }

    function updateDotPositions() {
      const rect = image.getBoundingClientRect();
      const naturalWidth = image.naturalWidth || rect.width || 1;
      const naturalHeight = image.naturalHeight || rect.height || 1;
      const place = (marker, xField, yField) => {
        if (!marker || !xField || !yField || !rect.width || !rect.height) return;
        const x = Number(xField.value || 0);
        const y = Number(yField.value || 0);
        const left = (x / naturalWidth) * rect.width;
        const top = (y / naturalHeight) * rect.height;
        marker.style.left = `${left}px`;
        marker.style.top = `${top}px`;
      };
      place(nameMarker, nameX, nameY);
      place(dateMarker, dateX, dateY);
      updatePreviewTypography();
    }

    function bindDrag(handle, marker, xField, yField) {
      if (!handle || !marker || !xField || !yField) return;
      let dragging = false;
      function move(event) {
        if (!dragging) return;
        const rect = image.getBoundingClientRect();
        const naturalWidth = image.naturalWidth || rect.width || 1;
        const naturalHeight = image.naturalHeight || rect.height || 1;
        const point = event.touches ? event.touches[0] : event;
        const x = Math.max(0, Math.min(rect.width, point.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, point.clientY - rect.top));
        xField.value = Math.round((x / rect.width) * naturalWidth);
        yField.value = Math.round((y / rect.height) * naturalHeight);
        updateDotPositions();
      }
      function stop() {
        dragging = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', stop);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', stop);
      }
      function start(event) {
        if (overrideToggle && !overrideToggle.checked) return;
        event.preventDefault();
        dragging = true;
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', stop);
      }
      [handle, marker].forEach((element) => {
        if (!element) return;
        element.addEventListener('mousedown', start);
        element.addEventListener('touchstart', start, { passive: false });
      });
      [xField, yField].forEach((field) => field && field.addEventListener('input', updateDotPositions));
    }

    bindDrag(nameDot, nameMarker, nameX, nameY);
    bindDrag(dateDot, dateMarker, dateX, dateY);
    [nameFontSize, dateFontSize].forEach((field) => field && field.addEventListener('input', updateDotPositions));

    const backgroundInput = document.getElementById('templateCertificateBackground');
    if (backgroundInput) {
      backgroundInput.addEventListener('change', () => {
        const value = backgroundInput.value.trim();
        if (value) image.src = value;
      });
    }
    if (overrideToggle) {
      overrideToggle.addEventListener('change', syncEnabledState);
    }
    image.addEventListener('load', updateDotPositions);
    window.addEventListener('resize', updateDotPositions);
    syncEnabledState();
    updateDotPositions();
  }

  function initializeBulkIssueJobs() {
    const body = document.getElementById('bulkIssueJobsBody');
    if (!body) return;

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function draw(jobs) {
      if (!Array.isArray(jobs) || !jobs.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-row">No bulk issue jobs yet.</td></tr>';
        return;
      }
      body.innerHTML = jobs.map((job) => `
        <tr>
          <td><strong>${escapeHtml(job.id || '')}</strong><div class="table-subtext">${escapeHtml(job.badgeTemplateTitle || job.badgeTemplateId || '')}</div></td>
          <td>${escapeHtml(String(job.status || 'pending'))}</td>
          <td>${escapeHtml(String(job.totalRows || 0))}</td>
          <td>${escapeHtml(String(job.completedRows || 0))}</td>
          <td>${escapeHtml(String(job.failedRows || 0))}</td>
          <td>${escapeHtml(job.createdAt || '')}</td>
        </tr>
      `).join('');
    }

    draw(window.__BULK_ISSUE_JOBS__ || []);
    window.setInterval(async () => {
      try {
        const response = await fetch('/admin/bulk-issue/jobs.json', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        draw(payload.jobs || []);
      } catch (error) {
      }
    }, 2500);
  }

  bindCopyButtons();
  bindDeleteConfirms();
  autoFillIssueForm();
  bindFileLoaders();
  bindUploadInputs();
  bindCoordinateEditor();
  initializeBulkIssueJobs();
})();
