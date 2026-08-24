// Command screening for the MCP tools. Commands run without per-call approval,
// so this list is the last thing standing between an assistant and a host.
const DESTRUCTIVE_RULES = [
    {
        // rm -rf / and friends, including --no-preserve-root
        pattern: /\brm\b[^|;&\n]*\s-[a-zA-Z]*[rR][a-zA-Z]*f|\brm\b[^|;&\n]*\s-[a-zA-Z]*f[a-zA-Z]*[rR]/,
        guard: /\s(\/|\/\*|\/\s|~|\$HOME|\/etc|\/var|\/usr|\/boot|\/bin|\/sbin|\/lib|\/home)(\s|$|\*)/,
        reason: 'recursive force delete of a system path'
    },
    { pattern: /--no-preserve-root/, reason: 'delete with --no-preserve-root' },
    { pattern: /\bmkfs(\.\w+)?\b/, reason: 'filesystem format' },
    { pattern: /\b(fdisk|gdisk|parted|wipefs|sgdisk|sfdisk)\b/, reason: 'disk partition modification/wipe' },
    { pattern: /\bdd\b[^|;&\n]*\bof=\/dev\//, reason: 'raw write to a block device' },
    { pattern: />\s*\/dev\/(sd|nvme|vd|hd|mmcblk)\w*/, reason: 'redirect over a block device' },
    { pattern: /\b(shutdown|poweroff|halt)\b/, reason: 'host shutdown' },
    { pattern: /\breboot\b/, reason: 'host reboot' },
    { pattern: /\binit\s+0\b/, reason: 'host shutdown' },
    { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
    { pattern: /\bchmod\b[^|;&\n]*\s-[a-zA-Z]*R[a-zA-Z]*\s+[0-7]{3,4}\s+\/(\s|$)/, reason: 'recursive chmod of /' },
    { pattern: /\bchown\b[^|;&\n]*\s-[a-zA-Z]*R[a-zA-Z]*\s+[^\s]+\s+\/(\s|$)/, reason: 'recursive chown of /' },
    { pattern: /\buserdel\b|\bgroupdel\b/, reason: 'account deletion' },
    { pattern: /\biptables\b[^|;&\n]*\s-F\b/, reason: 'firewall flush' },
    { pattern: /\bhistory\s+-c\b/, reason: 'shell history wipe' },
    { pattern: /\bcrontab\b[^|;&\n]*\s-r\b/, reason: 'crontab removal' },
    { pattern: /\bdrop\s+(database|schema|table)\b/i, reason: 'database drop command' },
    { pattern: /\btruncate\s+table\b/i, reason: 'database truncate table command' },
    { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Windows disk format command' },
    { pattern: /\bdiskpart\b/i, reason: 'Windows disk partitioning tool' },
    { pattern: /\bdel\b[^|;&\n]*\s(\/[fFsSqQ]\s*)+[a-zA-Z]:\\/i, reason: 'Windows recursive drive deletion' },
    { pattern: />\s*\/proc\/sysrq-trigger/, reason: 'kernel sysrq emergency trigger' }
];

// Returns { allowed, reason }. `settings` is a normalised MCP settings object.
function inspectCommand(command, settings = {}) {
    const text = String(command || '');
    if (!text.trim()) {
        return { allowed: false, reason: 'command is empty' };
    }

    if (settings.blockDestructiveCommands !== false) {
        for (const rule of DESTRUCTIVE_RULES) {
            if (!rule.pattern.test(text)) continue;
            // Some rules only fire when a second condition also matches, so that
            // an ordinary `rm -rf ./build` is not treated as a system wipe.
            if (rule.guard && !rule.guard.test(text)) continue;
            return { allowed: false, reason: rule.reason };
        }
    }

    const custom = Array.isArray(settings.blockedPatterns) ? settings.blockedPatterns : [];
    const lowered = text.toLowerCase();
    for (const pattern of custom) {
        const needle = String(pattern || '').trim().toLowerCase();
        if (needle && lowered.includes(needle)) {
            return { allowed: false, reason: `matched blocked pattern "${pattern}"` };
        }
    }

    return { allowed: true };
}

module.exports = {
    inspectCommand,
    DESTRUCTIVE_RULES
};
