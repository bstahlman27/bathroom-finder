let map;
let userLocation = null;
let userMarker = null;
let findBtn;
let recenterBtn;
let destMarker = null;
let destLocation = null;
let routePolyline = null;
let routeOutline = null;
let hasCentered = false;

function setupButtons() {
    const findButton = document.getElementById("findBathroomsBtn");
    if (findButton) {
        findBtn = findButton;
        findBtn.disabled = true;
        findBtn.style.position = "fixed";
        findBtn.style.left = "50%";
        findBtn.style.bottom = "10%";
        findBtn.style.transform = "translateX(-50%)";
        findBtn.style.zIndex = "9999";
        findBtn.style.pointerEvents = "auto";
    }

    const recenterButton = document.getElementById("recenterBtn");
    if (recenterButton) {
        recenterBtn = recenterButton;
        recenterBtn.style.position = "fixed";
        recenterBtn.style.right = "20px";
        recenterBtn.style.bottom = "10%";
        recenterBtn.style.zIndex = "9999";
        recenterBtn.style.pointerEvents = "auto";
    }
}

function initializeMap() {
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 0, lng: 0},
        zoom: 2,
    });

    const controlsEl = document.getElementById("controls");
    if (controlsEl) {
        controlsEl.style.display = "none";
        map.controls[google.maps.ControlPosition.LEFT_TOP].push(controlsEl);
    }
    
    const loadingEl = document.getElementById("loading");
    if (loadingEl) loadingEl.style.display = "none";

    setupButtons();

    if (findBtn) {
        findBtn.addEventListener("click", () => {
            findBathrooms();
            if (controlsEl) {
                controlsEl.style.display = "block";
            }
            findBtn.innerHTML = `<b>Search again</b>`;
        });
    }

    if (recenterBtn) {
        recenterBtn.addEventListener("click", () => {
            if (userLocation) {
                map.setCenter(userLocation);
                map.setZoom(16);
            }
        });
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
        if (findBtn) {
            findBtn.disabled = false;
            recenterBtn.disabled = false;
        };

        if (!hasCentered) {
            map.setCenter(userLocation);
            map.setZoom(16);
            hasCentered = true;
        }

        if (!userMarker) {
            userMarker = new google.maps.Marker({
                position: userLocation,
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
    },
    (error) => {
        console.error(error);
        alert("Location is required to use this app.")
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
}

async function findBathrooms() {
    if (!userLocation) {
        alert("Location not ready yet.");
        return;
    }
    
    const url = `https://gotta-go-bathroom-finder.onrender.com/api/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}`;

    try {
        const resp = await fetch(url);
        const data = await resp.json();

        if (!resp.ok){
            console.error("Nearby error:", data);
            alert("Nearby search failed. Check Console.");
            return;
        }

        const places = data.places ?? [];
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

    let firstItem = null;

    enriched.slice(0, 10).forEach(({ place, lat, lng, distanceMeters }, index) => {
        const name = place.displayName?.text ?? "Unnamed place";
        const miles = (distanceMeters / 1609.34).toFixed(2);

        const li = document.createElement("li");
        li.innerHTML = `
            <div class="result-item">
                <span class="result-name"><b>${name}</b></span>
                <span class="result-miles">${miles} mi</span>
            </div>
        `;

        li.addEventListener("click", () => {
            document.querySelectorAll("#results li").forEach(item => {
                item.classList.remove("selected");
            });
            li.classList.add("selected");

            destLocation = { lat, lng };
            if (destMarker) destMarker.setMap(null);
            destMarker = new google.maps.Marker({
                position: destLocation,
                map,
                title: name,
            });
            drawRouteToDestination(name);
        });

        if (index === 0) {
            firstItem = li;
        }

        resultsList.appendChild(li);
    });

    if (firstItem) {
        firstItem.click();
    }
}

async function drawRouteToDestination(placeName) {
    if (!userLocation || !destLocation) return;

    const url = `https://gotta-go-bathroom-finder.onrender.com/api/route?oLat=${userLocation.lat}&oLng=${userLocation.lng}&dLat=${destLocation.lat}&dLng=${destLocation.lng}`;
    
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
    if (routeOutline) routeOutline.setMap(null);

    routePolyline = new google.maps.Polyline({ 
        path,
        map,
        strokeColor: "#1a73e8",
        strokeOpacity: 0.9,
        strokeWeight: 6,
        zIndex: 10,
    });

    routeOutline = new google.maps.Polyline({
        path,
        map,
        strokeColor: "#ffffff",
        strokeOpacity: 1,
        strokeWeight: 10,
        zIndex: 9,
    })

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds);

    const mins = Math.round(parseDurationSeconds(route.duration) / 60);
    const miles = (route.distanceMeters / 1609.34).toFixed(1);
    const routeInfo = document.getElementById("routeInfo");
    if (routeInfo) {
        routeInfo.innerHTML = `<b>${miles}</b> mi • <b>${mins}</b> min to <b>${placeName}</b>`;
        routeInfo.style.display = "block";
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