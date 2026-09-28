document.addEventListener("DOMContentLoaded", function () {

    const navbars = document.querySelectorAll(
        'nav[class*="autofy-nav-"]'
    );

    navbars.forEach(function (nav) {

        const menu = nav.querySelector("ul");

        if (!menu) {
            return;
        }

        const button = document.createElement("button");

        button.className = "autofy-nav-hamburger";
        button.type = "button";
        button.innerHTML = "☰";

        button.setAttribute("aria-label", "Toggle navigation");
        button.setAttribute("aria-expanded", "false");

        nav.insertBefore(button, menu);

        button.addEventListener("click", function () {

            menu.classList.toggle("mobile-open");

            const open = menu.classList.contains("mobile-open");

            button.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );

            button.innerHTML = open ? "✕" : "☰";

        });

    });

});