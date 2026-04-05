export function formatNumber(num) {
    if (num === undefined || num === null) return '0';
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return Math.floor(num).toString();
}

export function formatTime(totalSeconds) {
    if (totalSeconds <= 0) {
        return '0s';
    }

    if (totalSeconds < 1) {
        const ms = Math.floor(totalSeconds * 1000);
        return `${ms}ms`;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts = [];
    if (hours > 0) {
        parts.push(`${hours}hr`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}min`);
    }
    if (seconds > 0 || parts.length === 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(' ');
}