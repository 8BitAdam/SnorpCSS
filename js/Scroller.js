document.addEventListener('click', (event) => {
  // Find closest anchor tag
  const link = event.target.closest('a');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href || !href.includes('#')) return;

  // Extract the ID after the '#'
  const id = href.split('#')[1];
  if (!id) return; // Skip bare "#"

  // Find target by ID or name
  const target = document.getElementById(id) || document.getElementsByName(id)[0];

  if (target) {
    // STOP instant browser jump
    event.preventDefault();

    // Smooth scroll
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    // Update URL bar without triggering a page jump
    history.pushState(null, null, `#${id}`);
  }
});