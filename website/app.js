const repo = {
    owner: "DeveloperKubilay",
    name: "termix"
};

const fallbackRelease = {
    tag_name: "v1.0.13",
    html_url: "https://github.com/DeveloperKubilay/termix/releases/tag/v1.0.13",
    published_at: "2026-03-06T00:17:10Z",
    assets: [
        {
            name: "Termix-1.0.13-win-x64.exe",
            browser_download_url: "https://github.com/DeveloperKubilay/termix/releases/download/v1.0.13/Termix-1.0.13-win-x64.exe",
            size: 118502391,
            download_count: 0
        },
        {
            name: "Termix-1.0.13-linux-x86_64.AppImage",
            browser_download_url: "https://github.com/DeveloperKubilay/termix/releases/download/v1.0.13/Termix-1.0.13-linux-x86_64.AppImage",
            size: 144690751,
            download_count: 0
        },
        {
            name: "Termix-1.0.13-mac-arm64.dmg",
            browser_download_url: "https://github.com/DeveloperKubilay/termix/releases/download/v1.0.13/Termix-1.0.13-mac-arm64.dmg",
            size: 139688413,
            download_count: 0
        }
    ]
};

const platforms = [
    {
        id: "windows",
        label: "Windows",
        title: "Native installer",
        description: "Best for Windows 10 and 11 desktops that need a direct executable installer."
    },
    {
        id: "linux",
        label: "Linux",
        title: "Portable AppImage",
        description: "Good fit for Linux desktops and ops boxes where a portable desktop build is enough."
    },
    {
        id: "macos",
        label: "macOS",
        title: "Apple Silicon DMG",
        description: "Direct DMG build for macOS devices with a native desktop install flow."
    }
];

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    initReveal();
    renderRelease(fallbackRelease, { source: "fallback" });
    hydrateLatestRelease();
});

function cacheElements() {
    elements.heroDownloadLink = document.getElementById("hero-download-link");
    elements.heroDownloadNote = document.getElementById("hero-download-note");
    elements.heroReleaseTag = document.getElementById("hero-release-tag");
    elements.heroReleaseMode = document.getElementById("hero-release-mode");
    elements.topbarLatestLink = document.getElementById("topbar-latest-link");
    elements.releaseTag = document.getElementById("release-tag");
    elements.releaseDate = document.getElementById("release-date");
    elements.releaseBuilds = document.getElementById("release-builds");
    elements.releaseStatus = document.getElementById("release-status");
    elements.releaseStatusDate = document.getElementById("release-status-date");
    elements.releasePageLink = document.getElementById("release-page-link");
    elements.downloadGrid = document.getElementById("download-grid");
}

function initReveal() {
    const items = Array.from(document.querySelectorAll(".reveal"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
        items.forEach((item) => item.classList.add("is-visible"));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
        });
    }, {
        threshold: 0.16
    });

    items.forEach((item) => observer.observe(item));
}

async function hydrateLatestRelease() {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/releases/latest`;

    try {
        const response = await fetch(url, {
            headers: {
                Accept: "application/vnd.github+json"
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API returned ${response.status}`);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.assets)) {
            throw new Error("Latest release payload is missing assets.");
        }

        renderRelease(data, { source: "live" });
    } catch (error) {
        console.warn("Falling back to pinned release:", error);
        renderRelease(fallbackRelease, { source: "fallback" });
    }
}

function renderRelease(release, options = {}) {
    const source = options.source === "live" ? "live" : "fallback";
    const cards = buildDownloadCards(release);
    const recommendedCard = pickRecommendedCard(cards);
    const availableCount = cards.filter((card) => card.asset).length;
    const published = formatDate(release.published_at);
    const releaseUrl = release.html_url || fallbackRelease.html_url;
    const releaseTag = release.tag_name || fallbackRelease.tag_name;

    if (elements.releaseTag) elements.releaseTag.textContent = releaseTag;
    if (elements.heroReleaseTag) elements.heroReleaseTag.textContent = releaseTag;
    if (elements.releaseDate) elements.releaseDate.textContent = published;
    if (elements.releaseStatusDate) elements.releaseStatusDate.textContent = published;
    if (elements.releaseBuilds) {
        elements.releaseBuilds.textContent = `${availableCount} installer${availableCount === 1 ? "" : "s"}`;
    }

    if (elements.releasePageLink) {
        elements.releasePageLink.href = releaseUrl;
        elements.releasePageLink.textContent = source === "live"
            ? `Release notes for ${releaseTag}`
            : `Release notes for ${releaseTag}`;
    }

    if (elements.releaseStatus) {
        elements.releaseStatus.className = `release-status ${source === "live" ? "is-live" : "is-fallback"}`;
        elements.releaseStatus.textContent = "100% local and open source";
    }

    if (elements.heroReleaseMode) {
        elements.heroReleaseMode.textContent = source === "live"
            ? "Live stable build"
            : "Pinned stable build";
    }

    if (elements.topbarLatestLink) {
        elements.topbarLatestLink.href = recommendedCard.asset ? recommendedCard.asset.browser_download_url : releaseUrl;
        elements.topbarLatestLink.textContent = source === "live"
            ? `Download ${releaseTag}`
            : "Latest build";
    }

    if (elements.heroDownloadLink) {
        elements.heroDownloadLink.href = recommendedCard.asset ? recommendedCard.asset.browser_download_url : releaseUrl;
        elements.heroDownloadLink.textContent = recommendedCard.asset
            ? `Download for ${recommendedCard.platform.label}`
            : "View release assets";
    }

    if (elements.heroDownloadNote) {
        elements.heroDownloadNote.textContent = recommendedCard.asset
            ? `${source === "live" ? "Latest stable desktop build resolved automatically." : "Pinned stable desktop build is shown."} ${recommendedCard.asset.name} • ${formatBytes(recommendedCard.asset.size)}.`
            : `${source === "live" ? "Latest stable release detected." : "Pinned stable release is shown."} Open the release notes to choose the correct installer.`;
    }

    if (elements.downloadGrid) {
        elements.downloadGrid.innerHTML = cards.map((card) => renderCard(card, releaseUrl)).join("");
    }
}

function buildDownloadCards(release) {
    const assets = getDownloadAssets(release.assets);
    const userPlatform = detectPlatform();

    return platforms.map((platform) => {
        const matches = assets
            .filter((asset) => matchesPlatform(asset, platform.id))
            .sort((left, right) => scoreAsset(right, platform.id) - scoreAsset(left, platform.id));

        return {
            platform,
            asset: matches[0] || null,
            alternates: matches.slice(1),
            recommended: platform.id === userPlatform
        };
    });
}

function pickRecommendedCard(cards) {
    return cards.find((card) => card.recommended && card.asset)
        || cards.find((card) => card.asset)
        || cards[0];
}

function getDownloadAssets(assets) {
    return (Array.isArray(assets) ? assets : []).filter((asset) => {
        const name = String(asset && asset.name ? asset.name : "").toLowerCase();
        return Boolean(name) && !name.endsWith(".blockmap") && !name.endsWith(".yml");
    });
}

function matchesPlatform(asset, platformId) {
    const name = String(asset && asset.name ? asset.name : "").toLowerCase();

    if (platformId === "windows") {
        return name.includes("-win-") || name.endsWith(".exe");
    }

    if (platformId === "linux") {
        return name.includes("-linux-") || name.endsWith(".appimage");
    }

    if (platformId === "macos") {
        return name.includes("-mac-") || name.endsWith(".dmg");
    }

    return false;
}

function scoreAsset(asset, platformId) {
    const name = String(asset && asset.name ? asset.name : "").toLowerCase();
    let score = 0;

    if (platformId === "windows" && name.endsWith(".exe")) score += 5;
    if (platformId === "linux" && name.endsWith(".appimage")) score += 5;
    if (platformId === "macos" && name.endsWith(".dmg")) score += 5;
    if (/(x64|x86_64|amd64)/i.test(name)) score += 2;
    if (/(arm64|aarch64)/i.test(name)) score += 2;

    return score;
}

function renderCard(card, releaseUrl) {
    const safePlatform = escapeHtml(card.platform.label);
    const safeTitle = escapeHtml(card.platform.title);
    const safeDescription = escapeHtml(card.platform.description);
    const recommendedBadge = card.recommended ? '<span class="download-badge">Recommended</span>' : "";

    if (!card.asset) {
        return `
            <article class="download-card${card.recommended ? " recommended" : ""}">
                <div class="download-top">
                    <div>
                        <div class="download-os">${safePlatform}</div>
                        <h3>${safeTitle}</h3>
                    </div>
                    ${recommendedBadge}
                </div>
                <p>${safeDescription}</p>
                <div class="download-empty">
                    No direct installer was detected for this platform in the latest stable release. Open the release notes to inspect the available assets manually.
                </div>
                <a class="button secondary" href="${escapeHtml(releaseUrl)}" target="_blank" rel="noreferrer">Open release notes</a>
            </article>
        `;
    }

    const meta = [
        {
            label: "Asset",
            value: card.asset.name
        },
        {
            label: "Architecture",
            value: extractArch(card.asset.name)
        },
        {
            label: "Size",
            value: formatBytes(card.asset.size)
        }
    ];

    const metaHtml = meta.map((item) => `
        <div class="download-meta-item">
            <span>${escapeHtml(item.label)}</span>
            <span>${escapeHtml(item.value)}</span>
        </div>
    `).join("");

    const alternateHtml = card.alternates.length
        ? `<div class="download-links">${card.alternates.map((asset) => `
            <a href="${escapeHtml(asset.browser_download_url)}" target="_blank" rel="noreferrer">${escapeHtml(asset.name)}</a>
        `).join("")}</div>`
        : "";

    return `
        <article class="download-card${card.recommended ? " recommended" : ""}">
            <div class="download-top">
                <div>
                    <div class="download-os">${safePlatform}</div>
                    <h3>${safeTitle}</h3>
                </div>
                ${recommendedBadge}
            </div>
            <p>${safeDescription}</p>
            <div class="download-meta">${metaHtml}</div>
            <a class="button primary" href="${escapeHtml(card.asset.browser_download_url)}" target="_blank" rel="noreferrer">
                Download ${escapeHtml(extractArch(card.asset.name))}
            </a>
            ${alternateHtml}
        </article>
    `;
}

function detectPlatform() {
    const signature = [
        navigator.userAgentData && navigator.userAgentData.platform,
        navigator.platform,
        navigator.userAgent
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (signature.includes("mac")) return "macos";
    if (signature.includes("win")) return "windows";
    if (signature.includes("linux") || signature.includes("x11")) return "linux";
    return "windows";
}

function formatDate(value) {
    if (!value) return "Unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Unknown";

    return new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(parsed);
}

function formatBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return "Unknown size";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const rounded = value >= 100 || unitIndex === 0 ? Math.round(value) : value.toFixed(1);
    return `${rounded} ${units[unitIndex]}`;
}

function extractArch(name) {
    const value = String(name || "");
    if (/arm64|aarch64/i.test(value)) return "ARM64";
    if (/x86_64|x64|amd64/i.test(value)) return "x64";
    if (/universal/i.test(value)) return "Universal";
    return "Desktop build";
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
