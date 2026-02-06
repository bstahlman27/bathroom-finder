import express from "express";
import "dotenv/config";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:5500");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
});

const API_KEY = process.env.MAPS_API_KEY;
const WEB_API_KEY = process.env.WEB_API_KEY;

app.get("/api/maps-config", (req, res) => {
    res.json({
        mapsUrl: `https://maps.googleapis.com/maps/api/js?key=${WEB_API_KEY}&libraries=geometry&callback=initializeMap`
    });
});

app.get("/api/nearby", async (req, res) => {
    try {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: "Invalid lat/lng" });
        }

        const radius = 3000;

        const types = [
        "gas_station",
        "fast_food_restaurant",
        "cafe",
        "supermarket",
        "convenience_store",
        "store",
        "pharmacy",
        "rest_stop",
        "public_bathroom",
        "library",
        "city_hall",
        "post_office",
        "community_center",
        "hotel",
        "bowling_alley",
        ];

        const baseBody = {
        locationRestriction: {
            circle: {
            center: { latitude: lat, longitude: lng },
            radius,
            },
        },
        maxResultCount: 19,
        };

        const requests = types.map((t) =>
        fetch("https://places.googleapis.com/v1/places:searchNearby", {
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": API_KEY,
            "X-Goog-FieldMask":
                "places.id,places.displayName,places.location,places.formattedAddress,places.types",
            },
            body: JSON.stringify({ ...baseBody, includedTypes: [t] }),
        }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json(), type: t }))
        );

        const responses = await Promise.all(requests);

        for (const r of responses) {
        if (!r.ok) console.warn("Nearby type failed:", r.type, r.status, r.data?.error?.message);
        }

        const allPlaces = responses.flatMap((r) => r.data?.places ?? []);

        const mapById = new Map();
        for (const p of allPlaces) {
        if (!p?.id) continue;
        if (!mapById.has(p.id)) mapById.set(p.id, p);
        }

        res.json({ places: Array.from(mapById.values()) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

app.get("/api/route", async (req, res) => {
    try {
        const oLat = Number(req.query.oLat);
        const oLng = Number(req.query.oLng);
        const dLat = Number(req.query.dLat);
        const dLng = Number(req.query.dLng);

        if (![oLat, oLng, dLat, dLng].every(Number.isFinite)) {
            return res.status(400).json({ error: "Invalid origin/destination" });
        }

        const body = {
            origin: { location: { latLng: { latitude: oLat, longitude: oLng }}},
            destination: { location: { latLng: { latitude: dLat, longitude: dLng }}},
            travelMode:"DRIVE",
            routingPreference: "TRAFFIC_AWARE"
        };

        const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": API_KEY,
                "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
            },
            body: JSON.stringify(body)
        });

        const data = await resp.json();

        if(!resp.ok) return res.status(resp.status).json(data);

        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(3001, () => {
    console.log("Server running on http://localhost:3001");
});