import { getWeatherSummary } from './src/modules/ai/tools/tool.weather.js';

async function testWeather() {
    console.log("Testing Weather Tool...");

    // Test 1: With explicit coordinates (New York City)
    console.log("\n--- Test 1: Coordinates (NYC) ---");
    const result1 = await getWeatherSummary({ location: { lat: 40.7128, lng: -74.0060 } });
    console.log("Result 1:", result1 ? "SUCCESS" : "FAILED", result1);

    // Test 2: With City Name (Paris)
    console.log("\n--- Test 2: City Name (Paris) ---");
    const result2 = await getWeatherSummary({ location: { city: "Paris", country: "France" } });
    console.log("Result 2:", result2 ? "SUCCESS" : "FAILED", result2);

    // Test 3: With Ambiguous Name (Cordoba - requires geocoding resolution)
    console.log("\n--- Test 3: Ambiguous Name (Cordoba) ---");
    const result3 = await getWeatherSummary({ location: "Cordoba" });
    console.log("Result 3:", result3 ? "SUCCESS" : "FAILED", result3);
}

testWeather();
