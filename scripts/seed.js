// seed.js
const url = "http://127.0.0.1:3000/api/ingestion";
const data = {
    title: "בקופה מוניירי - Bacopa monnieri",
    url: "https://bara.co.il/bacopa/",
    content: "בקופה מוניירי, או 'פשטה משתרעת', הוא צמח מרפא מרכזי ברפואת האיורוודה. הוא נחשב ל'מזין מוח' (Medhya Rasayana) ומשמש מסורתית לשיפור קוגניציה, חידוד הזיכרון, העלאת רמת הריכוז ולהפחתת מצבי סטרס וחרדה. מחקרים מראים כי החומרים הפעילים בו, Bacosides, מסייעים בהגנה על תאי העצב ובשיקום סינפסות במוח. הצמח נחשב בטוח לשימוש גם לילדים עם בעיות קשב וריכוז, ולרוב נדרש שימוש מצטבר של מספר שבועות כדי להרגיש את מלוא ההשפעה הקלינית שלו."
};

console.log("Sending data to Pinecone...");

fetch(url, {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
})
.then(async (res) => {
    const json = await res.json();
    if (!res.ok) {
        console.error("❌ Failed:", res.status, json);
    } else {
        console.log("✅ Success:", json);
    }
})
.catch((err) => {
    console.error("❌ Network Error:", err);
});