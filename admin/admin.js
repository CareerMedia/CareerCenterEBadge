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

  function autoFillIssueForm() {
    const select = document.getElementById('badgeTemplateId');
    if (!select || !Array.isArray(window.__TEMPLATES__)) {
      return;
    }

    const fields = {
      badgeTitle: document.getElementById('badgeTitle'),
      badgeLabel: document.getElementById('badgeLabel'),
      description: document.getElementById('description'),
      meaning: document.getElementById('meaning'),
      criteria: document.getElementById('criteria'),
      issuerName: document.getElementById('issuerName'),
      issuerOrganization: document.getElementById('issuerOrganization'),
      issuerWebsite: document.getElementById('issuerWebsite'),
      careerCenterUrl: document.getElementById('careerCenterUrl'),
      badgeImage: document.getElementById('badgeImage'),
      certificateBackground: document.getElementById('certificateBackground')
    };

    select.addEventListener('change', () => {
      const template = window.__TEMPLATES__.find((item) => item.id === select.value);
      if (!template) return;
      if (fields.badgeTitle) fields.badgeTitle.value = template.title || '';
      if (fields.badgeLabel) fields.badgeLabel.value = template.badgeLabel || '';
      if (fields.description) fields.description.value = template.description || '';
      if (fields.meaning) fields.meaning.value = template.meaning || '';
      if (fields.criteria) fields.criteria.value = template.criteria || '';
      if (fields.issuerName) fields.issuerName.value = template.issuerName || '';
      if (fields.issuerOrganization) fields.issuerOrganization.value = template.issuerOrganization || '';
      if (fields.issuerWebsite) fields.issuerWebsite.value = template.issuerWebsite || '';
      if (fields.careerCenterUrl) fields.careerCenterUrl.value = template.careerCenterUrl || '';
      if (fields.badgeImage) fields.badgeImage.value = template.badgeImage || '';
      if (fields.certificateBackground) fields.certificateBackground.value = template.certificateBackground || '';
    });
  }

  bindCopyButtons();
  bindDeleteConfirms();
  autoFillIssueForm();
})();
