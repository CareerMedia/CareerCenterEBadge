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

  function bindBulkIssueProgressPage() {
    const jobId = window.__BULK_ISSUE_ACTIVE_JOB__;
    const shell = document.querySelector('.bulk-progress-shell');
    if (!jobId || !shell) return;

    const statusEl = document.getElementById('bulkProgressStatus');
    const fillEl = document.getElementById('bulkProgressFill');
    const percentEl = document.getElementById('bulkProgressPercent');
    const completedEl = document.getElementById('bulkProgressCompleted');
    const totalEl = document.getElementById('bulkProgressTotal');
    const failedEl = document.getElementById('bulkProgressFailed');

    function clampPercent(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    }

    function updateUi(job) {
      if (!job) return;
      const pct = clampPercent(job.progressPercent);
      if (statusEl) statusEl.textContent = String(job.status || 'pending');
      if (percentEl) percentEl.textContent = String(pct);
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (completedEl) completedEl.textContent = String(job.completedRows || 0);
      if (totalEl) totalEl.textContent = String(job.totalRows || 0);
      if (failedEl) failedEl.textContent = String(job.failedRows || 0);
      shell.setAttribute('aria-valuenow', String(pct));
    }

    async function pollOnce() {
      const response = await fetch('/admin/bulk-issue/jobs.json', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const jobs = payload.jobs || [];
      const job = jobs.find((j) => j && j.id === jobId);
      if (!job) return;

      updateUi(job);
      if (job.status === 'completed' || job.status === 'completed_with_errors') {
        window.location.href = `/admin/bulk-issue/success?job=${encodeURIComponent(jobId)}`;
      } else if (job.status === 'failed') {
        window.location.href = `/admin/bulk-issue/validate?notice=${encodeURIComponent('Bulk issue job failed. Review and try again.')}&job=${encodeURIComponent(jobId)}`;
      }
    }

    pollOnce().catch(() => {});
    window.setInterval(() => {
      pollOnce().catch(() => {});
    }, 1200);
  }

  function bindAwardEmailAdminPage() {
    const state = window.__EMAIL_AWARD_STATE__;
    const builtin = window.__EMAIL_BUILTIN__;
    const form = document.getElementById('emailAwardSettingsForm');
    const hiddenJson = document.getElementById('emailAwardTemplatesJson');
    const saveModeInput = document.getElementById('saveModeInput');
    if (!state || !form || !hiddenJson) return;

    function escapeHtmlAttr(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    let templates = JSON.parse(JSON.stringify(state.templates || []));
    if (!templates.length && builtin) {
      templates = [
        {
          id: 'default',
          name: 'Default award email',
          subject: builtin.subject || '',
          bodyPlain: builtin.text || '',
          bodyHtml: builtin.html || ''
        }
      ];
    }
    if (!templates.length) {
      return;
    }

    let activeId = (state.defaultId && templates.some((t) => t.id === state.defaultId)) ? state.defaultId : templates[0].id;
    let activeTab = 'plain';

    const pick = document.getElementById('emailTemplatePicker');
    const nameEl = document.getElementById('emailTplName');
    const idEl = document.getElementById('emailTplId');
    const subEl = document.getElementById('emailTplSubject');
    const plainEl = document.getElementById('emailTplBodyPlain');
    const htmlEl = document.getElementById('emailTplBodyHtml');
    const defSel = document.getElementById('emailAwardDefaultTemplateId');
    const tabBtns = form.querySelectorAll('.wp-like-tabs__btn');
    const panePlain = document.getElementById('emailTplPanePlain');
    const paneHtml = document.getElementById('emailTplPaneHtml');

    function currentTpl() {
      return templates.find((t) => t.id === activeId);
    }

    function persistEditorToTemplate() {
      const t = currentTpl();
      if (!t || !nameEl || !subEl || !plainEl || !htmlEl) return;
      t.name = nameEl.value;
      t.subject = subEl.value;
      t.bodyPlain = plainEl.value;
      t.bodyHtml = htmlEl.value;
    }

    function loadEditor() {
      const t = currentTpl();
      if (!t || !nameEl || !idEl || !subEl || !plainEl || !htmlEl) return;
      nameEl.value = t.name || '';
      idEl.value = t.id || '';
      subEl.value = t.subject || '';
      plainEl.value = t.bodyPlain || '';
      htmlEl.value = t.bodyHtml || '';
    }

    function escapeOptionText(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function rebuildPickers() {
      if (!pick || !defSel) return;
      pick.innerHTML = templates
        .map((t) => `<option value="${escapeHtmlAttr(t.id)}">${escapeOptionText(t.name || t.id)}</option>`)
        .join('');
      pick.value = activeId;
      const prevDef = defSel.value;
      defSel.innerHTML = templates
        .map((t) => `<option value="${escapeHtmlAttr(t.id)}">${escapeOptionText(t.name || t.id)}</option>`)
        .join('');
      if (templates.some((x) => x.id === prevDef)) {
        defSel.value = prevDef;
      } else {
        defSel.value = templates[0].id;
      }
    }

    function setTabUi(tab) {
      activeTab = tab;
      tabBtns.forEach((b) => {
        const on = b.getAttribute('data-tab') === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const showPlain = tab === 'plain';
      if (panePlain) panePlain.hidden = !showPlain;
      if (paneHtml) paneHtml.hidden = showPlain;
    }

    async function runSync(mode, text) {
      const r = await fetch('/admin/email/sync-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, text }),
        credentials: 'same-origin'
      });
      const j = await r.json();
      if (!j.ok) {
        throw new Error(j.error || 'Sync failed');
      }
      return j.text;
    }

    async function ensureSyncedBodies() {
      if (!plainEl || !htmlEl) return;
      if (activeTab === 'plain') {
        if (String(plainEl.value || '').trim()) {
          htmlEl.value = await runSync('plainToHtml', plainEl.value);
        }
      } else if (String(htmlEl.value || '').trim()) {
        plainEl.value = await runSync('htmlToPlain', htmlEl.value);
      }
    }

    function commitToHiddenField() {
      persistEditorToTemplate();
      hiddenJson.value = JSON.stringify(templates);
    }

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const next = btn.getAttribute('data-tab');
        if (!next || next === activeTab) return;
        persistEditorToTemplate();
        try {
          if (activeTab === 'plain' && next === 'html') {
            if (String(plainEl.value || '').trim()) {
              htmlEl.value = await runSync('plainToHtml', plainEl.value);
            }
          } else if (activeTab === 'html' && next === 'plain') {
            if (String(htmlEl.value || '').trim()) {
              plainEl.value = await runSync('htmlToPlain', htmlEl.value);
            }
          }
        } catch (err) {
          window.alert(err.message || String(err));
          return;
        }
        persistEditorToTemplate();
        setTabUi(next);
      });
    });

    if (pick) {
      pick.addEventListener('change', async () => {
        try {
          await ensureSyncedBodies();
        } catch (err) {
          window.alert(err.message || String(err));
          pick.value = activeId;
          return;
        }
        persistEditorToTemplate();
        activeId = pick.value;
        loadEditor();
        setTabUi('plain');
      });
    }

    const addBtn = document.getElementById('emailTemplateAdd');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        try {
          await ensureSyncedBodies();
        } catch (err) {
          window.alert(err.message || String(err));
          return;
        }
        persistEditorToTemplate();
        const nid = `tmpl-${Date.now()}`;
        const b = builtin || {};
        templates.push({
          id: nid,
          name: 'New template',
          subject: b.subject || '',
          bodyPlain: b.text || '',
          bodyHtml: b.html || ''
        });
        activeId = nid;
        rebuildPickers();
        loadEditor();
        setTabUi('plain');
        commitToHiddenField();
      });
    }

    const delBtn = document.getElementById('emailTemplateDelete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (templates.length <= 1) {
          window.alert('Keep at least one email template.');
          return;
        }
        try {
          await ensureSyncedBodies();
        } catch (err) {
          window.alert(err.message || String(err));
          return;
        }
        persistEditorToTemplate();
        const delId = activeId;
        templates = templates.filter((t) => t.id !== delId);
        activeId = templates[0].id;
        if (defSel && defSel.value === delId) {
          defSel.value = activeId;
        }
        rebuildPickers();
        loadEditor();
        setTabUi('plain');
        commitToHiddenField();
      });
    }

    function attachLiveCommit(el) {
      if (!el) return;
      el.addEventListener('input', () => {
        persistEditorToTemplate();
        hiddenJson.value = JSON.stringify(templates);
      });
    }
    attachLiveCommit(nameEl);
    attachLiveCommit(subEl);
    attachLiveCommit(plainEl);
    attachLiveCommit(htmlEl);

    async function finalizeAndSubmit(saveMode, triggerBtn) {
      if (triggerBtn) {
        triggerBtn.disabled = true;
      }
      try {
        try {
          await ensureSyncedBodies();
        } catch (err) {
          window.alert(err.message || String(err));
          return;
        }
        commitToHiddenField();
        if (saveModeInput) {
          saveModeInput.value = saveMode === 'templates_only' ? 'templates_only' : 'full';
        }
        form.dataset.readyToSubmit = '1';
        form.submit();
      } finally {
        if (triggerBtn) {
          setTimeout(() => {
            triggerBtn.disabled = false;
          }, 4000);
        }
      }
    }

    const saveTemplatesBtn = document.getElementById('saveTemplatesOnlyBtn');
    if (saveTemplatesBtn) {
      saveTemplatesBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        finalizeAndSubmit('templates_only', saveTemplatesBtn);
      });
    }
    const saveAllBtn = document.getElementById('saveAllEmailBtn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        finalizeAndSubmit('full', saveAllBtn);
      });
    }

    form.addEventListener('submit', (ev) => {
      if (form.dataset.readyToSubmit === '1') {
        return;
      }
      ev.preventDefault();
      finalizeAndSubmit(saveModeInput && saveModeInput.value === 'templates_only' ? 'templates_only' : 'full', null);
    });

    rebuildPickers();
    loadEditor();
    setTabUi('plain');
    commitToHiddenField();
  }

  bindCopyButtons();
  bindDeleteConfirms();
  autoFillIssueForm();
  bindFileLoaders();
  bindUploadInputs();
  bindCoordinateEditor();
  initializeBulkIssueJobs();
  bindBulkIssueProgressPage();
  bindAwardEmailAdminPage();
})();
