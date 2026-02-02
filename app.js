let map;
let userLocation = null;
let userMarker = null;
let findBtn;
let destMarker = null;
let destLocation = null;
let routePolyline = null;
let hasCentered = false;
let followUser = true;
let resumeFollowTimer = null;

function initializeMap() {

    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 0, lng: 0},
        zoom: 2,
    });

    const loadingEl = document.getElementById("loading");
    if (loadingEl) loadingEl.style.display = "none";

    function pauseFollowTemporarily(){
        followUser = false;

        if (resumeFollowTimer) clearTimeout(resumeFollowTimer);
        resumeFollowTimer = setTimeout(() => {
            followUser = true;
            if (userLocation) map.panTo(userLocation);
        }, 10000);
    }

    map.addListener("dragstart", pauseFollowTemporarily);
    map.addListener("zoom_changed", pauseFollowTemporarily);

    findBtn = document.getElementById("findBathroomsBtn");
    if (findBtn) {
        findBtn.addEventListener("click", findBathrooms);
    }

    if (!("geolocation" in navigator)) {
        alert("Geolocation is not supported by your browser");
        return;
    }

    navigator.geolocation.watchPosition((position) => {
        userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
        };
        if (findBtn) findBtn.disabled = false;

        if (!hasCentered) {
            map.setCenter(userLocation);
            map.setZoom(14);
            hasCentered = true;
        }

        if (followUser) {
            map.panTo(userLocation);
        }

        if (!userMarker) {
        userMarker = new google.maps.Marker({
            position: userLocation,
            zoom: 14,
            map,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#1a73e8",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
            },
        });
        } else {
            userMarker.setPosition(userLocation);
        }
        (error) => {
            console.error(error);
            alert("Location is required to use this app.")
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    });
}

async function findBathrooms() {
    if (!userLocation) {
        alert("Location not ready yet.");
        return;
    }
    
    const url = `http://localhost:3001/api/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}`;

    try {
        const resp = await fetch(url);
        const data = await resp.json();

        if (!resp.ok){
            console.error("Nearby error:", data);
            alert("Nearby search failed. Check Console.");
            return;
        }

        const places = data.places ?? []
        displayResults(places);
    } catch (e) {
        console.error(e);
        alert("Could not reach backend. Make sure server is running.")
    }
}

function dedupePlacesById(places) {
    const seen = new Set();
    const out = [];

    for (const p of places) {
        const id = p.id;
        if (!id) continue;
        if (seen.has(id)) continue;

        seen.add(id);
        out.push(p);
    }
    return out;
}

function normalizePlaceName(name) {
    return(name ?? "").toLowerCase().split("|")[0].trim();
}

function dedupePlacesByNameAndProxy(enriched, thresholdMeters = 25) {
    const out = [];

    for (const item of enriched) {
        const name = normalizePlaceName(item.place.displayName?.text);
        if (!name) {
            out.push(item);
            continue;
        }
    
        const isDupe = out.some((existing) => {
            const existingName = normalizePlaceName(existing.place.displayName?.text);
            if (existingName !== name) return false;

            const metersApart = haversineDistance(
                { lat: existing.lat, lng: existing.lng },
                { lat: item.lat, lng: item.lng }
            );

            return metersApart <= thresholdMeters;
        });

        if (!isDupe) out.push(item);
    }
    return out;
}

function displayResults(places) {
    const resultsList = document.getElementById("results");
    resultsList.innerHTML = "";

    places = dedupePlacesById(places);

    let enriched = places.map((place) => {
        const lat = place.location?.latitude;
        const lng = place.location?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const distanceMeters = haversineDistance(userLocation, { lat, lng });
        return {place, lat, lng, distanceMeters};
    })
    .filter(Boolean);

    enriched = dedupePlacesByNameAndProxy(enriched, 25);

    enriched.sort((a, b) => a.distanceMeters - b.distanceMeters);

    enriched.slice(0, 10).forEach(({ place, lat, lng, distanceMeters }) => {
        const name = place.displayName?.text ?? "Unnamed place";
        const miles = (distanceMeters / 1609.34).toFixed(2);

        const li = document.createElement("li");
        li.textContent = `${name} (${miles} mi)`;

        li.addEventListener("click", () => {
        destLocation = { lat, lng };
        if (destMarker) destMarker.setMap(null);
        destMarker = new google.maps.Marker({
            position: destLocation,
            map,
            title: name,
        });
        drawRouteToDestination(name);
        });

        resultsList.appendChild(li);
    });
}

async function drawRouteToDestination(placeName) {
    if (!userLocation || !destLocation) return;

    const url = `http://localhost:3001/api/route?oLat=${userLocation.lat}&oLng=${userLocation.lng}&dLat=${destLocation.lat}&dLng=${destLocation.lng}`;
    
    const resp = await fetch(url);
    const data = await resp.json();

    if (!resp.ok) {
        console.error("Route error:", data);
        alert("Route failed. Check console.");
        return;
    }

    const route = data.routes?.[0];
    if (!route?.polyline?.encodedPolyline){
        alert("No route returned.");
        return;
    }

    const path = google.maps.geometry.encoding.decodePath(route.polyline.encodedPolyline);

    if (routePolyline) routePolyline.setMap(null);

    routePolyline = new google.maps.Polyline({
        path,
        map,
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds);

    const mins = Math.round(parseDurationSeconds(route.duration) / 60);
    const miles = (route.distanceMeters / 1609.34).toFixed(1);
    const routeInfo = document.getElementById("routeInfo");
    if (routeInfo) {
        routeInfo.textContent = `${miles} mi * ~${mins} min to ${placeName}`;
    }
}

function parseDurationSeconds(durationStr) {
    if (typeof durationStr !== "string") return 0;
    const match = durationStr.match(/^(\d+)s$/);
    return match ? Number(match[1]) : 0;
}

function haversineDistance(a, b) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

window.initializeMap = initializeMap;