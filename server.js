import express from "express";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import cors from "cors";

const app = express();
app.use(express.json());

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'], // Next.js dev server
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// 🔑 Your API keys
const GOOGLE_MAPS_API_KEY = "AIzaSyBGNzHoT1SJCM7J3zvGbxyyiOlsO9ps_H8";
const GEMINI_API_KEY = "AIzaSyB9L7UmUhdlUiC3-txcVCEBQc5ewIuffkU";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ✅ Test route
app.get("/", (req, res) => {
  res.send("🌍 City Problem Reporter Backend is running!");
});

// 🔧 Helper: Convert Latitude/Longitude to City Name
async function getCityNameFromCoordinates(latitude, longitude) {
  try {
    console.log(`🗺️ Converting coordinates to city name: ${latitude}, ${longitude}`);
    
    const reverseGeoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    
    const response = await axios.get(reverseGeoUrl);
    
    if (response.data.results && response.data.results.length > 0) {
      const results = response.data.results;
      
      // Find the city/town/municipality level address
      let cityName = null;
      let district = null;
      let province = null;
      let fullAddress = results[0].formatted_address;
      
      // Parse address components
      for (let component of results[0].address_components) {
        const types = component.types;
        
        if (types.includes('locality')) {
          cityName = component.long_name;
        }
        if (types.includes('administrative_area_level_2')) {
          district = component.long_name;
        }
        if (types.includes('administrative_area_level_1')) {
          province = component.long_name;
        }
      }
      
      // Fallback to formatted address parsing if city not found
      if (!cityName) {
        const parts = fullAddress.split(',');
        cityName = parts[parts.length - 3]?.trim() || "Unknown Location";
      }
      
      const locationInfo = {
        cityName: cityName || "Unknown",
        district: district || "Unknown",
        province: province || "Unknown",
        fullAddress: fullAddress,
        coordinates: { latitude, longitude }
      };
      
      console.log(`✅ Location Identified:`);
      console.log(`   City: ${locationInfo.cityName}`);
      console.log(`   District: ${locationInfo.district}`);
      console.log(`   Province: ${locationInfo.province}`);
      
      return locationInfo;
    }
    
    return {
      cityName: "Unknown Location",
      district: "Unknown",
      province: "Unknown",
      fullAddress: "Unable to determine",
      coordinates: { latitude, longitude }
    };
    
  } catch (error) {
    console.error("❌ Reverse geocoding error:", error.message);
    return {
      cityName: "Error determining location",
      district: "Unknown",
      province: "Unknown",
      fullAddress: "Error",
      coordinates: { latitude, longitude }
    };
  }
}

// 🔧 Helper: Calculate road distance and duration
async function calculateRoadDistance(userLat, userLng, officeLat, officeLng) {
  try {
    const distanceUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${userLat},${userLng}&destinations=${officeLat},${officeLng}&mode=driving&units=metric&key=${GOOGLE_MAPS_API_KEY}`;
    
    const response = await axios.get(distanceUrl);
    const element = response.data.rows[0]?.elements[0];

    if (element?.status === "OK") {
      return {
        distance: element.distance.text,
        distanceValue: element.distance.value,
        duration: element.duration.text,
        durationValue: element.duration.value,
        status: "OK"
      };
    } else {
      return {
        distance: "Not available",
        duration: "Not available",
        status: element?.status || "UNKNOWN"
      };
    }
  } catch (error) {
    console.error("❌ Distance calculation error:", error.message);
    return {
      distance: "Error calculating distance",
      duration: "Not available",
      status: "ERROR"
    };
  }
}

// 🔧 Helper: Get detailed place info from Google Maps
async function getPlaceDetails(placeId) {
  const fields = [
    "name",
    "formatted_address",
    "formatted_phone_number",
    "international_phone_number",
    "website",
    "url",
    "geometry",
    "opening_hours",
    "rating",
    "user_ratings_total"
  ].join(",");

  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
  
  try {
    const response = await axios.get(detailsUrl);
    return response.data.result;
  } catch (error) {
    console.error("❌ Error fetching place details:", error.message);
    return null;
  }
}

// 🔧 NEW: Use Gemini to search for ALL emails - Divisional Secretariat AND Pradeshiya Sabha
async function searchAllEmailsWithGemini(name, address, cityName) {
  try {
    console.log(`📧 Searching for ALL email addresses for: ${name} in ${cityName}`);
    console.log(`📧 Will also search for related Pradeshiya Sabha emails`);
    
    const prompt = `
Search the web thoroughly and find ALL email addresses for BOTH:
1. Divisional Secretariat office
2. Pradeshiya Sabha (local council) in the same area

Office Information:
- Name: ${name}
- Address: ${address}
- City: ${cityName}
- Country: Sri Lanka

For DIVISIONAL SECRETARIAT, find:
- General office email (ds@, info@, contact@)
- Director/Divisional Secretary email
- Department emails (land, births/deaths, welfare, etc.)
- Administrative emails
- Public inquiry emails

For PRADESHIYA Sabha (same area), find:
- Main Pradeshiya Sabha office email
- Chairman email
- Secretary email  
- Department emails
- Administrative emails

Search in:
- Official government websites (.gov.lk domains)
- Local government directories
- Provincial council websites
- Official announcements and press releases
- Government contact directories

Return ONLY a JSON object:
{
  "divisionalSecretariat": {
    "emails": [
      {
        "address": "email@ds.gov.lk",
        "type": "general/director/department/administrative",
        "department": "name of department if applicable",
        "description": "what this email is for",
        "verified": true/false
      }
    ],
    "primaryEmail": "main DS email"
  },
  "pradeshiyaSabha": {
    "emails": [
      {
        "address": "email@ps.gov.lk",
        "type": "general/chairman/secretary/department",
        "department": "name of department if applicable",
        "description": "what this email is for",
        "verified": true/false
      }
    ],
    "primaryEmail": "main PS email",
    "officeName": "name of the Pradeshiya Sabha"
  },
  "totalFound": number,
  "searchSummary": "summary of findings"
}

CRITICAL:
- ONLY return emails directly related to Divisional Secretariat or Pradeshiya Sabha
- DO NOT include emails from other organizations, ministries, or unrelated offices
- Mark verified: true only if found on official .gov.lk sources
- If no Pradeshiya Sabha found, return empty array for that section
`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.1,
      }
    });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{
        googleSearch: {}
      }]
    });
    
    const response = result.response;
    const text = response.text();
    
    console.log("📧 Gemini email search result:", text.substring(0, 300) + "...");
    
    // Extract JSON
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                     text.match(/(\{[\s\S]*?\})/);
    
    if (jsonMatch) {
      const emailData = JSON.parse(jsonMatch[1].trim());
      const dsCount = emailData.divisionalSecretariat?.emails?.length || 0;
      const psCount = emailData.pradeshiyaSabha?.emails?.length || 0;
      console.log(`✅ Found ${dsCount} DS email(s) and ${psCount} PS email(s)`);
      return emailData;
    }
    
    // Fallback: extract and categorize emails from text
    console.log("⚠️ Extracting emails from text...");
    return extractAllEmailsFromText(text);
    
  } catch (error) {
    console.error("❌ Email search error:", error.message);
    return null;
  }
}

// 🔧 Helper: Extract and categorize emails from text
function extractAllEmailsFromText(text) {
  const emailRegex = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
  const foundEmails = text.match(emailRegex) || [];
  
  // Remove duplicates
  const uniqueEmails = [...new Set(foundEmails)];
  
  // Categorize emails by keywords
  const dsEmails = [];
  const psEmails = [];
  
  uniqueEmails.forEach(email => {
    const emailLower = email.toLowerCase();
    
    // Check if it's Pradeshiya Sabha related
    if (emailLower.includes('ps.') || 
        emailLower.includes('pradeshiya') || 
        emailLower.includes('sabha') ||
        emailLower.includes('chairman') ||
        emailLower.includes('localcouncil')) {
      psEmails.push({
        address: email,
        type: "general",
        description: "Extracted from search results - Pradeshiya Sabha",
        verified: false
      });
    } 
    // Check if it's Divisional Secretariat related
    else if (emailLower.includes('ds.') || 
             emailLower.includes('divisional') ||
             emailLower.includes('secretariat') ||
             emailLower.includes('secretary@') ||
             emailLower.includes('district')) {
      dsEmails.push({
        address: email,
        type: "general",
        description: "Extracted from search results - Divisional Secretariat",
        verified: false
      });
    }
    // Default to DS if unclear but from gov.lk
    else if (emailLower.includes('.gov.lk')) {
      dsEmails.push({
        address: email,
        type: "general",
        description: "Extracted from search results",
        verified: false
      });
    }
  });
  
  return {
    divisionalSecretariat: {
      emails: dsEmails,
      primaryEmail: dsEmails[0]?.address || null
    },
    pradeshiyaSabha: {
      emails: psEmails,
      primaryEmail: psEmails[0]?.address || null,
      officeName: "Related Pradeshiya Sabha"
    },
    totalFound: dsEmails.length + psEmails.length,
    searchSummary: "Extracted and categorized from text"
  };
}

// 🔧 NEW: Search for phones - DS and PS offices only
async function searchAllPhonesWithGemini(name, address, cityName) {
  try {
    console.log(`📞 Searching for phone numbers (DS & PS only) for: ${name} in ${cityName}`);
    
    const prompt = `
Search the web and find phone numbers for ONLY these offices:
1. Divisional Secretariat
2. Pradeshiya Sabha in the same area

Office Information:
- Name: ${name}
- Address: ${address}
- City: ${cityName}
- Country: Sri Lanka

Find phone numbers for:
DIVISIONAL SECRETARIAT:
- Main office landline
- Director's office
- Department phones
- Fax numbers

PRADESHIYA SABHA:
- Main office phone
- Chairman's office
- Secretary's office
- Department phones

Return ONLY a JSON object:
{
  "divisionalSecretariat": {
    "phones": [
      {
        "number": "phone with +94 code",
        "type": "landline/mobile/fax",
        "description": "office/department name",
        "verified": true/false
      }
    ],
    "primaryPhone": "main DS phone"
  },
  "pradeshiyaSabha": {
    "phones": [
      {
        "number": "phone with +94 code",
        "type": "landline/mobile/fax",
        "description": "office/department name",
        "verified": true/false
      }
    ],
    "primaryPhone": "main PS phone",
    "officeName": "PS name"
  },
  "totalFound": number
}

CRITICAL: Only include phones for DS and PS offices, not other organizations.
Format all numbers with +94 country code.
`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: { temperature: 0.1 }
    });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }]
    });
    
    const text = result.response.text();
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                     text.match(/(\{[\s\S]*?\})/);
    
    if (jsonMatch) {
      const phoneData = JSON.parse(jsonMatch[1].trim());
      const dsCount = phoneData.divisionalSecretariat?.phones?.length || 0;
      const psCount = phoneData.pradeshiyaSabha?.phones?.length || 0;
      console.log(`✅ Found ${dsCount} DS phone(s) and ${psCount} PS phone(s)`);
      return phoneData;
    }
    
    return extractAllPhonesFromText(text);
    
  } catch (error) {
    console.error("❌ Phone search error:", error.message);
    return null;
  }
}

// 🔧 Helper: Extract and categorize phones from text
function extractAllPhonesFromText(text) {
  const phoneRegex = /(\+94[\d\s-]{9,}|0[\d\s-]{9,})/g;
  const foundPhones = text.match(phoneRegex) || [];
  
  const uniquePhones = [...new Set(foundPhones.map(p => p.trim()))];
  
  const phones = uniquePhones.map(phone => ({
    number: phone,
    type: "general",
    description: "Extracted from search results",
    verified: false
  }));
  
  return {
    divisionalSecretariat: {
      phones: phones,
      primaryPhone: phones[0]?.number || null
    },
    pradeshiyaSabha: {
      phones: [],
      primaryPhone: null,
      officeName: "Related Pradeshiya Sabha"
    },
    totalFound: phones.length
  };
}

// 🔧 NEW: Search for websites - DS and PS only
async function searchAllWebsitesWithGemini(name, address, cityName) {
  try {
    console.log(`🌐 Searching for websites (DS & PS only) for: ${name} in ${cityName}`);
    
    const prompt = `
Search the web and find websites for ONLY these offices:
1. Divisional Secretariat
2. Pradeshiya Sabha in the same area

Office Information:
- Name: ${name}
- Address: ${address}
- City: ${cityName}

Find:
DIVISIONAL SECRETARIAT:
- Official government website
- District/Provincial portal pages
- Social media (Facebook, Twitter)
- Contact/directory pages

PRADESHIYA SABHA:
- Official website
- Social media pages
- Government portal listings

Return ONLY a JSON object:
{
  "divisionalSecretariat": {
    "websites": [
      {
        "url": "full URL with https://",
        "type": "official/social/directory/portal",
        "platform": "website/facebook/twitter/etc",
        "description": "brief description",
        "verified": true/false
      }
    ],
    "primaryWebsite": "main website"
  },
  "pradeshiyaSabha": {
    "websites": [
      {
        "url": "full URL",
        "type": "official/social/directory",
        "platform": "website/facebook/etc",
        "description": "brief description",
        "verified": true/false
      }
    ],
    "primaryWebsite": "main website",
    "officeName": "PS name"
  },
  "totalFound": number
}

CRITICAL: Only include websites for DS and PS offices, not other organizations.
`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: { temperature: 0.1 }
    });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }]
    });
    
    const text = result.response.text();
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                     text.match(/(\{[\s\S]*?\})/);
    
    if (jsonMatch) {
      const websiteData = JSON.parse(jsonMatch[1].trim());
      const dsCount = websiteData.divisionalSecretariat?.websites?.length || 0;
      const psCount = websiteData.pradeshiyaSabha?.websites?.length || 0;
      console.log(`✅ Found ${dsCount} DS website(s) and ${psCount} PS website(s)`);
      return websiteData;
    }
    
    return { 
      divisionalSecretariat: { websites: [], primaryWebsite: null },
      pradeshiyaSabha: { websites: [], primaryWebsite: null, officeName: "Related Pradeshiya Sabha" },
      totalFound: 0 
    };
    
  } catch (error) {
    console.error("❌ Website search error:", error.message);
    return null;
  }
}

// 🔧 IMPROVED: Get complete contact info - DS and PS separated
async function getCompleteContactInfo(googleDetails, name, address, cityName) {
  console.log("\n📋 Step 2: Getting contact info for DS and PS offices...");
  
  // Start with Google Maps data (only for DS)
  const googlePhone = googleDetails.formatted_phone_number || 
                      googleDetails.international_phone_number || null;
  const googleWebsite = googleDetails.website || null;
  
  console.log(`📍 From Google Maps (Divisional Secretariat):`);
  console.log(`   Phone: ${googlePhone || "❌ Not available"}`);
  console.log(`   Website: ${googleWebsite || "❌ Not available"}`);
  console.log(`   Email: ❌ Not in Google Maps`);
  
  // Search for ALL contact info using Gemini + Google Search
  console.log(`\n🔍 Searching web for DS and PS contact details in ${cityName}...`);
  const [emailData, phoneData, websiteData] = await Promise.all([
    searchAllEmailsWithGemini(name, address, cityName),
    searchAllPhonesWithGemini(name, address, cityName),
    searchAllWebsitesWithGemini(name, address, cityName)
  ]);
  
  // Compile Divisional Secretariat data
  const dsEmails = emailData?.divisionalSecretariat?.emails || [];
  const dsPhones = phoneData?.divisionalSecretariat?.phones || [];
  const dsWebsites = websiteData?.divisionalSecretariat?.websites || [];
  
  // Add Google Maps data to DS if not already included
  if (googlePhone && !dsPhones.some(p => p.number.includes(googlePhone))) {
    dsPhones.unshift({
      number: googlePhone,
      type: "landline",
      description: "From Google Maps",
      verified: true
    });
  }
  
  if (googleWebsite && !dsWebsites.some(w => w.url === googleWebsite)) {
    dsWebsites.unshift({
      url: googleWebsite,
      type: "official",
      platform: "website",
      description: "Official website from Google Maps",
      verified: true
    });
  }
  
  // Add pattern-generated DS emails if none found
  if (dsEmails.length === 0) {
    const officeName = name.toLowerCase()
      .replace(/divisional secretariat/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    
    if (officeName) {
      dsEmails.push({
        address: `${officeName}@ds.gov.lk`,
        type: "general",
        department: null,
        description: "Pattern-generated main email",
        verified: false
      });
      dsEmails.push({
        address: `info@${officeName}.ds.gov.lk`,
        type: "general",
        department: null,
        description: "Pattern-generated alternative",
        verified: false
      });
    }
  }
  
  // Compile Pradeshiya Sabha data
  const psEmails = emailData?.pradeshiyaSabha?.emails || [];
  const psPhones = phoneData?.pradeshiyaSabha?.phones || [];
  const psWebsites = websiteData?.pradeshiyaSabha?.websites || [];
  const psOfficeName = emailData?.pradeshiyaSabha?.officeName || 
                       phoneData?.pradeshiyaSabha?.officeName || 
                       websiteData?.pradeshiyaSabha?.officeName ||
                       "Related Pradeshiya Sabha";
  
  console.log(`\n✅ Contact Collection Complete:`);
  console.log(`   📧 DS Emails: ${dsEmails.length}`);
  console.log(`   📞 DS Phones: ${dsPhones.length}`);
  console.log(`   🌐 DS Websites: ${dsWebsites.length}`);
  console.log(`   ---`);
  console.log(`   📧 PS Emails: ${psEmails.length}`);
  console.log(`   📞 PS Phones: ${psPhones.length}`);
  console.log(`   🌐 PS Websites: ${psWebsites.length}`);
  
  return {
    divisionalSecretariat: {
      primary: {
        phone: googlePhone || dsPhones[0]?.number || "Not available",
        email: emailData?.divisionalSecretariat?.primaryEmail || dsEmails[0]?.address || "Not available",
        website: googleWebsite || websiteData?.divisionalSecretariat?.primaryWebsite || dsWebsites[0]?.url || "Not available"
      },
      all: {
        emails: dsEmails,
        phones: dsPhones,
        websites: dsWebsites
      },
      summary: {
        totalEmails: dsEmails.length,
        totalPhones: dsPhones.length,
        totalWebsites: dsWebsites.length,
        verifiedEmails: dsEmails.filter(e => e.verified).length,
        verifiedPhones: dsPhones.filter(p => p.verified).length,
        verifiedWebsites: dsWebsites.filter(w => w.verified).length
      }
    },
    pradeshiyaSabha: {
      officeName: psOfficeName,
      primary: {
        phone: phoneData?.pradeshiyaSabha?.primaryPhone || psPhones[0]?.number || "Not available",
        email: emailData?.pradeshiyaSabha?.primaryEmail || psEmails[0]?.address || "Not available",
        website: websiteData?.pradeshiyaSabha?.primaryWebsite || psWebsites[0]?.url || "Not available"
      },
      all: {
        emails: psEmails,
        phones: psPhones,
        websites: psWebsites
      },
      summary: {
        totalEmails: psEmails.length,
        totalPhones: psPhones.length,
        totalWebsites: psWebsites.length,
        verifiedEmails: psEmails.filter(e => e.verified).length,
        verifiedPhones: psPhones.filter(p => p.verified).length,
        verifiedWebsites: psWebsites.filter(w => w.verified).length
      }
    }
  };
}

// ✅ Main Route: Find office with ALL contact information
app.post("/find-office", async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ 
      error: "Missing latitude or longitude",
      example: { latitude: 6.9271, longitude: 79.8612 }
    });
  }

  try {
    console.log(`\n📍 === NEW SEARCH REQUEST ===`);
    console.log(`User Location: ${latitude}, ${longitude}`);

    // 0️⃣ Convert coordinates to city name
    const locationInfo = await getCityNameFromCoordinates(latitude, longitude);
    console.log(`\n📍 Location identified: ${locationInfo.cityName}, ${locationInfo.district}`);

    // 1️⃣ Find nearest office
    let radius = 3000;
    let allOffices = [];
    let nearestOffice = null;

    while (!nearestOffice && radius <= 50000) {
      console.log(`🔍 Searching within ${radius / 1000}km for Divisional Secretariat in ${locationInfo.cityName}...`);
      
      const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${radius}&keyword=Divisional%20Secretariat%20Office&key=${GOOGLE_MAPS_API_KEY}`;
      
      const nearbyResponse = await axios.get(nearbyUrl);
      allOffices = nearbyResponse.data.results || [];
      
      if (allOffices.length > 0) {
        nearestOffice = allOffices[0];
        console.log(`✅ Found ${allOffices.length} office(s) in/near ${locationInfo.cityName}`);
        break;
      }
      
      radius += 5000;
    }

    if (!nearestOffice) {
      return res.status(404).json({
        error: `No Divisional Secretariat office found within 50 km of ${locationInfo.cityName}`,
        location: locationInfo
      });
    }

    // 2️⃣ Get Google Maps details
    console.log("\n📍 Step 1: Fetching from Google Maps API...");
    const officeDetails = await getPlaceDetails(nearestOffice.place_id);

    if (!officeDetails) {
      return res.status(500).json({ error: "Failed to fetch office details" });
    }

    const name = officeDetails.name || "Not available";
    const address = officeDetails.formatted_address || "Not available";
    const officeLat = officeDetails.geometry?.location?.lat;
    const officeLng = officeDetails.geometry?.location?.lng;
    const googleMapsUrl = officeDetails.url || `https://www.google.com/maps?q=${officeLat},${officeLng}`;

    // 3️⃣ Get ALL contact information (with city name)
    const contactInfo = await getCompleteContactInfo(officeDetails, name, address, locationInfo.cityName);

    // 4️⃣ Calculate road distance
    console.log("\n🚗 Step 3: Calculating road distance...");
    const distanceInfo = await calculateRoadDistance(latitude, longitude, officeLat, officeLng);
    console.log(`✅ Distance: ${distanceInfo.distance}, Duration: ${distanceInfo.duration}`);

    // 5️⃣ Compile response with separated DS and PS data + location info
    const result = {
      userLocation: {
        cityName: locationInfo.cityName,
        district: locationInfo.district,
        province: locationInfo.province,
        coordinates: locationInfo.coordinates,
        fullAddress: locationInfo.fullAddress
      },
      office: {
        name,
        address,
        coordinates: {
          latitude: officeLat,
          longitude: officeLng
        }
      },
      divisionalSecretariat: {
        contact: {
          primary: contactInfo.divisionalSecretariat.primary,
          allEmails: contactInfo.divisionalSecretariat.all.emails,
          allPhones: contactInfo.divisionalSecretariat.all.phones,
          allWebsites: contactInfo.divisionalSecretariat.all.websites,
          summary: contactInfo.divisionalSecretariat.summary
        }
      },
      pradeshiyaSabha: {
        officeName: contactInfo.pradeshiyaSabha.officeName,
        contact: {
          primary: contactInfo.pradeshiyaSabha.primary,
          allEmails: contactInfo.pradeshiyaSabha.all.emails,
          allPhones: contactInfo.pradeshiyaSabha.all.phones,
          allWebsites: contactInfo.pradeshiyaSabha.all.websites,
          summary: contactInfo.pradeshiyaSabha.summary
        }
      },
      distance: {
        roadDistance: distanceInfo.distance,
        drivingTime: distanceInfo.duration,
        distanceInMeters: distanceInfo.distanceValue,
        durationInSeconds: distanceInfo.durationValue
      },
      additionalInfo: {
        rating: officeDetails.rating || "Not rated",
        totalReviews: officeDetails.user_ratings_total || 0,
        googleMapsUrl,
        openingHours: officeDetails.opening_hours?.weekday_text || "Not available"
      },
      metadata: {
        searchRadius: `${radius / 1000} km`,
        totalOfficesFound: allOffices.length,
        dataStrategy: "Reverse Geocoding + Google Maps + Gemini Multi-Source Search (DS & PS Separated)",
        timestamp: new Date().toISOString()
      }
    };

    console.log("\n✅ === COMPLETE RESULTS ===");
    console.log(`\n📍 USER LOCATION:`);
    console.log(`   City: ${locationInfo.cityName}`);
    console.log(`   District: ${locationInfo.district}`);
    console.log(`   Province: ${locationInfo.province}`);
    console.log(`\n🏢 NEAREST OFFICE: ${name}`);
    console.log(`\n📧 DIVISIONAL SECRETARIAT:`);
    console.log(`   Primary Email: ${contactInfo.divisionalSecretariat.primary.email}`);
    console.log(`   Total Emails: ${contactInfo.divisionalSecretariat.summary.totalEmails} (${contactInfo.divisionalSecretariat.summary.verifiedEmails} verified)`);
    console.log(`   Total Phones: ${contactInfo.divisionalSecretariat.summary.totalPhones}`);
    console.log(`   Total Websites: ${contactInfo.divisionalSecretariat.summary.totalWebsites}`);
    console.log(`\n📧 PRADESHIYA SABHA (${contactInfo.pradeshiyaSabha.officeName}):`);
    console.log(`   Primary Email: ${contactInfo.pradeshiyaSabha.primary.email}`);
    console.log(`   Total Emails: ${contactInfo.pradeshiyaSabha.summary.totalEmails} (${contactInfo.pradeshiyaSabha.summary.verifiedEmails} verified)`);
    console.log(`   Total Phones: ${contactInfo.pradeshiyaSabha.summary.totalPhones}`);
    console.log(`   Total Websites: ${contactInfo.pradeshiyaSabha.summary.totalWebsites}`);
    console.log("========================\n");

    res.json(result);

  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ 
      error: "Internal server error",
      message: error.message 
    });
  }
});

// ✅ Compare multiple offices
app.post("/compare-offices", async (req, res) => {
  const { latitude, longitude, maxResults = 3 } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: "Missing latitude or longitude" });
  }

  try {
    // Get location name first
    const locationInfo = await getCityNameFromCoordinates(latitude, longitude);
    console.log(`\n🔍 Comparing offices near ${locationInfo.cityName}...`);

    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=20000&keyword=Divisional%20Secretariat%20Office&key=${GOOGLE_MAPS_API_KEY}`;
    const nearbyResponse = await axios.get(nearbyUrl);
    const offices = (nearbyResponse.data.results || []).slice(0, maxResults);

    if (offices.length === 0) {
      return res.status(404).json({ 
        error: `No offices found near ${locationInfo.cityName}`,
        location: locationInfo
      });
    }

    const officesWithDistance = await Promise.all(
      offices.map(async (office) => {
        const details = await getPlaceDetails(office.place_id);
        const lat = details?.geometry?.location?.lat;
        const lng = details?.geometry?.location?.lng;
        
        const distanceInfo = await calculateRoadDistance(latitude, longitude, lat, lng);
        
        return {
          name: details?.name || "Unknown",
          address: details?.formatted_address || "Not available",
          phone: details?.formatted_phone_number || "Not available",
          distance: distanceInfo.distance,
          duration: distanceInfo.duration,
          distanceValue: distanceInfo.distanceValue || 999999,
          rating: details?.rating || "Not rated",
          reviews: details?.user_ratings_total || 0
        };
      })
    );

    officesWithDistance.sort((a, b) => a.distanceValue - b.distanceValue);

    res.json({
      userLocation: {
        cityName: locationInfo.cityName,
        district: locationInfo.district,
        province: locationInfo.province
      },
      count: officesWithDistance.length,
      offices: officesWithDistance,
      recommendation: officesWithDistance[0].name,
      nearestCity: locationInfo.cityName
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ error: "Error comparing offices" });
  }
});

// ✅ New route: Get location info only
app.post("/get-location", async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ 
      error: "Missing latitude or longitude",
      example: { latitude: 6.9271, longitude: 79.8612 }
    });
  }

  try {
    const locationInfo = await getCityNameFromCoordinates(latitude, longitude);
    
    res.json({
      success: true,
      location: locationInfo
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ 
      error: "Error getting location information",
      message: error.message 
    });
  }
});

// ✅ Start server
const PORT = 5002;
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`\n📍 ENDPOINTS:`);
  console.log(`\n1️⃣  POST /get-location`);
  console.log(`    Convert coordinates to city name`);
  console.log(`    Body: { "latitude": 6.9271, "longitude": 79.8612 }`);
  console.log(`\n2️⃣  POST /find-office`);
  console.log(`    Find nearest Divisional Secretariat with full contact info`);
  console.log(`    Body: { "latitude": 6.9271, "longitude": 79.8612 }`);
  console.log(`\n3️⃣  POST /compare-offices`);
  console.log(`    Compare multiple nearby offices`);
  console.log(`    Body: { "latitude": 6.9271, "longitude": 79.8612, "maxResults": 3 }`);
  console.log(`\n🔄 Data Collection Strategy:`);
  console.log(`   1. Reverse Geocoding (coordinates → city name)`);
  console.log(`   2. Google Maps API (verified location & basic contact)`);
  console.log(`   3. Gemini searches Google for DS contact details`);
  console.log(`   4. Gemini searches Google for PS contact details`);
  console.log(`   5. Only DS and PS emails/phones/websites included`);
  console.log(`   6. Pattern generation as fallback\n`);
});