const { OFFICE_LOCATION } = require('../constant/data');

const calculateDistance = (userLoc, isFormat = false) => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (userLoc.latitude - OFFICE_LOCATION.latitude) * Math.PI / 180;
    const dLon = (userLoc.longitude - OFFICE_LOCATION.longitude) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(OFFICE_LOCATION.latitude * Math.PI / 180) *
        Math.cos(userLoc.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in meters

    return isFormat ? formatDistance(distance) : distance;
}

const formatDistance = (distanceInMeters) => {
    // Round to nearest whole number for meters
    const roundedMeters = Math.round(distanceInMeters);

    if (roundedMeters >= 1000) {
        // Convert to kilometers and round to 1 decimal place
        const distanceInKm = roundedMeters / 1000;
        return `${distanceInKm.toFixed(1)} km`;
    } else {
        return `${roundedMeters} m`;
    }
}

module.exports = { calculateDistance, formatDistance };