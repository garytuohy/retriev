// Retriev — Landing page JS

document.addEventListener('DOMContentLoaded', () => {
  // ── Waitlist forms ──
  ['hero-form', 'cta-form'].forEach(id => {
    const form = document.getElementById(id);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.querySelector('input[type="email"]').value;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Joining...';
      // Simulate API call
      await new Promise(r => setTimeout(r, 1200));
      btn.textContent = '✓ You\'re on the list!';
      btn.style.background = 'var(--success)';
      showToast('🎉 You\'re on the waitlist! We\'ll be in touch.', 'success');
      form.querySelector('input').value = '';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Get Early Access';
        btn.style.background = '';
      }, 4000);
    });
  });

  // ── FAQ accordion ──
  document.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  // ── Intersection observer for fade-in ──
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.card').forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = `opacity 0.5s ease ${i * 0.05}s, transform 0.5s ease ${i * 0.05}s`;
    observer.observe(card);
  });
});
