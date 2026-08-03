// Cargar subdominios dinámicamente desde /config.json en la barra de navegación
async function loadNavbar(activeUrl = '') {
    try {
        const response = await fetch('/config.json');
        const data = await response.json();
        const navbar = document.getElementById('dynamic-navbar');
        if (!navbar) return;

        navbar.innerHTML = '';

        // Contenedor Header (Brand + Botón Hamburguesa)
        const headerDiv = document.createElement('div');
        headerDiv.className = 'navbar-header';

        const brand = document.createElement('a');
        brand.href = '/';
        brand.className = 'navbar-brand';
        brand.innerHTML = `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/zap.svg'); mask-image: url('/img/icons/zap.svg'); width: 22px; height: 22px; margin-right: 8px;"></span>TOKISERVER`;
        headerDiv.appendChild(brand);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'navbar-toggle';
        toggleBtn.id = 'navbar-toggle-btn';
        toggleBtn.setAttribute('aria-label', 'Navegación');
        toggleBtn.innerHTML = `<span class="pixel-icon-mask" style="-webkit-mask-image: url('/img/icons/menu.svg'); mask-image: url('/img/icons/menu.svg'); width: 20px; height: 20px;"></span><span style="margin-left: 4px;">MENÚ</span>`;
        headerDiv.appendChild(toggleBtn);

        navbar.appendChild(headerDiv);

        // Contenedor de enlaces
        const linksDiv = document.createElement('div');
        linksDiv.className = 'navbar-links';
        linksDiv.id = 'navbar-links-container';

        const currentPath = window.location.pathname;

        // Enlace HOME
        const homeLink = document.createElement('a');
        homeLink.href = '/';
        const isHomeActive = (activeUrl === '/' || (activeUrl === '' && (currentPath === '/' || currentPath === '/index.html')));
        if (isHomeActive) {
            homeLink.classList.add('active');
        }
        homeLink.innerHTML = `<span class="pixel-icon-mask${isHomeActive ? ' magenta' : ''}" style="-webkit-mask-image: url('/img/icons/zap.svg'); mask-image: url('/img/icons/zap.svg'); width: 18px; height: 18px; margin-right: 6px;"></span>HOME`;
        linksDiv.appendChild(homeLink);

        if (data && data.subdomains) {
            data.subdomains.forEach(sub => {
                const link = document.createElement('a');
                
                const isSubActive = (activeUrl && (sub.url === activeUrl || sub.url === activeUrl + '/')) ||
                                    (!activeUrl && currentPath.startsWith(sub.url));

                if (isSubActive) {
                    link.classList.add('active');
                }

                if (sub.url.startsWith(':')) {
                    link.href = window.location.protocol + "//" + window.location.hostname + sub.url;
                    link.target = "_blank";
                } else {
                    link.href = sub.url;
                }

                const iconFile = sub.icon ? `/img/icons/${sub.icon}.svg` : '/img/icons/zap.svg';
                link.innerHTML = `<span class="pixel-icon-mask${isSubActive ? ' magenta' : ''}" style="-webkit-mask-image: url('${iconFile}'); mask-image: url('${iconFile}'); width: 18px; height: 18px; margin-right: 6px;"></span>${sub.name}`;
                
                linksDiv.appendChild(link);
            });
        }

        navbar.appendChild(linksDiv);

        // Event Listener para desplegar menú hamburguesa en móviles
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = linksDiv.classList.toggle('open');
            const iconMask = toggleBtn.querySelector('.pixel-icon-mask');
            const iconPath = isOpen ? '/img/icons/x.svg' : '/img/icons/menu.svg';
            if (iconMask) {
                iconMask.style.webkitMaskImage = `url('${iconPath}')`;
                iconMask.style.maskImage = `url('${iconPath}')`;
            }
        });

        // Cerrar menú al hacer clic fuera o en un enlace
        document.addEventListener('click', (e) => {
            if (!navbar.contains(e.target)) {
                linksDiv.classList.remove('open');
                const iconMask = toggleBtn.querySelector('.pixel-icon-mask');
                if (iconMask) {
                    iconMask.style.webkitMaskImage = "url('/img/icons/menu.svg')";
                    iconMask.style.maskImage = "url('/img/icons/menu.svg')";
                }
            }
        });

        linksDiv.querySelectorAll('a').forEach(l => {
            l.addEventListener('click', () => {
                linksDiv.classList.remove('open');
            });
        });

    } catch (error) {
        console.error('[NAVBAR] Error al cargar la configuración de navegación:', error);
    }
}


