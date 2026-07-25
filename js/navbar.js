// Cargar subdominios dinámicamente desde /config.json en la barra de navegación
async function loadNavbar(activeUrl = '') {
    try {
        const response = await fetch('/config.json');
        const data = await response.json();
        const navbar = document.getElementById('dynamic-navbar');
        if (!navbar) return;

        navbar.innerHTML = '<a href="/">HOME</a>';

        const currentPath = window.location.pathname;

        data.subdomains.forEach(sub => {
            const link = document.createElement('a');
            
            if (activeUrl && (sub.url === activeUrl || sub.url === activeUrl + '/')) {
                link.classList.add('active');
            } else if (!activeUrl && (sub.url === currentPath || sub.url + '/' === currentPath)) {
                link.classList.add('active');
            }

            if (sub.url.startsWith(':')) {
                link.href = window.location.protocol + "//" + window.location.hostname + sub.url;
            } else {
                link.href = sub.url;
            }
            link.innerText = sub.name;
            navbar.appendChild(link);
        });
    } catch (error) {
        console.error('[NAVBAR] Error al cargar la configuración de navegación:', error);
    }
}
