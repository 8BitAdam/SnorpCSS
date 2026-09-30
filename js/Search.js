(() => {
    const form = document.getElementById('asset-search');
    const queryInput = form?.querySelector('input[type="search"]');
    const typeSelect = form?.querySelector('select[name="type"]');
    const status = document.getElementById('search-status');

    if (!form || !queryInput || !typeSelect || !status) return;

    form.addEventListener('submit', (event) => {
        event.preventDefault();

        const query = queryInput.value.trim().toLocaleLowerCase();
        if (!query) return;

        const sectionId = typeSelect.value === 'js' ? 'js-index' : 'css-index';
        const cards = [...document.querySelectorAll(`#${sectionId} .index-card`)];
        const matches = cards
            .map((card) => {
                const title = card.querySelector('h4')?.textContent.trim().toLocaleLowerCase() ?? '';
                const filename = card.querySelector('code')?.textContent.trim().toLocaleLowerCase() ?? '';
                const content = card.textContent.toLocaleLowerCase();
                const score = title === query ? 0
                    : filename === query ? 1
                    : title.startsWith(query) ? 2
                    : filename.startsWith(query) ? 3
                    : title.includes(query) ? 4
                    : content.includes(query) ? 5
                    : Infinity;

                return { card, score };
            })
            .filter((match) => Number.isFinite(match.score))
            .sort((first, second) => first.score - second.score);

        if (matches.length) {
            window.location.assign(matches[0].card.href);
            return;
        }

        status.textContent = `No ${typeSelect.value.toUpperCase()} documentation matched "${queryInput.value.trim()}".`;
        status.hidden = false;
    });

    queryInput.addEventListener('input', () => {
        status.hidden = true;
    });
})();