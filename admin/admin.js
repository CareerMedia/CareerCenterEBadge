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
      pathwayItems: document.getElementById('pathwayItems')
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
    const nameDot = editor.querySelector('[data-coordinate-target="name"]');
    const dateDot = editor.querySelector('[data-coordinate-target="date"]');

    function updateDotPositions() {
      const rect = image.getBoundingClientRect();
      const naturalWidth = image.naturalWidth || rect.width || 1;
      const naturalHeight = image.naturalHeight || rect.height || 1;
      const place = (dot, xField, yField) => {
        if (!dot || !xField || !yField) return;
        const x = Number(xField.value || 0);
        const y = Number(yField.value || 0);
        const left = (x / naturalWidth) * rect.width;
        const top = (y / naturalHeight) * rect.height;
        dot.style.left = `${left}px`;
        dot.style.top = `${top}px`;
      };
      place(nameDot, nameX, nameY);
      place(dateDot, dateX, dateY);
    }

    function bindDrag(dot, xField, yField) {
      if (!dot || !xField || !yField) return;
      let dragging = false;
      function move(event) {
        if (!dragging) return;
        const rect = image.getBoundingClientRect();
        const naturalWidth = image.naturalWidth || rect.width || 1;
        const naturalHeight = image.naturalHeight || rect.height || 1;
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
        xField.value = Math.round((x / rect.width) * naturalWidth);
        yField.value = Math.round((y / rect.height) * naturalHeight);
        updateDotPositions();
      }
      const stop = () => {
        dragging = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', stop);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', stop);
      };
      const start = (event) => {
        event.preventDefault();
        dragging = true;
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', stop);
      };
      dot.addEventListener('mousedown', start);
      dot.addEventListener('touchstart', start, { passive: false });
      [xField, yField].forEach((field) => field && field.addEventListener('input', updateDotPositions));
    }

    bindDrag(nameDot, nameX, nameY);
    bindDrag(dateDot, dateX, dateY);
    const backgroundInput = document.getElementById('templateCertificateBackground');
    if (backgroundInput) {
      backgroundInput.addEventListener('change', () => {
        if (backgroundInput.value.trim()) {
          image.src = backgroundInput.value.trim();
        }
      });
    }
    image.addEventListener('load', updateDotPositions);
    window.addEventListener('resize', updateDotPositions);
    updateDotPositions();
  }

  bindCopyButtons();
  bindDeleteConfirms();
  autoFillIssueForm();
  bindFileLoaders();
  bindUploadInputs();
  bindCoordinateEditor();
})();
