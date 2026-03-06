import React, { useState, useEffect } from "react";
import "./dashboard.css";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState("selection");
  const [presses, setPresses] = useState([]);
  const [dieNumbers, setDieNumbers] = useState({});
  const [results, setResults] = useState({});
  const [savedPresses, setSavedPresses] = useState({});
  const [savedData, setSavedData] = useState([]);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split("T")[0]);
  const [toastMessage, setToastMessage] = useState(""); // Toast


  const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
  };

  const getAuthHeadersWithCSRF = async (method = "GET", contentType = true) => {
  const credentials = btoa("caddok:");

  // Step 1: Trigger cookie set
  await fetch("http://localhost:8080/internal/forge_lines", {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    credentials: "include",
  });

//   const csrfToken = getCookie("CSRFToken");
//   console.log("Fetched CSRF Token from cookie:", csrfToken);
//   if (!csrfToken) {
//     throw new Error("CSRF token not found in cookies.");
//   }

  const headers = {
    Authorization: `Basic ${credentials}`,
//     "X-CSRF-Token": csrfToken,
  };

  if (contentType) {
    headers["Content-Type"] = "application/json";
  }

  return {
    headers,
    credentials: "include",
  };
};


  // Shift calculation
  const getCurrentShift = () => {
    const now = new Date();
    const timeHHMM = now.toTimeString().slice(0, 5);
    if (timeHHMM >= "07:30" && timeHHMM < "15:30") return 1;
    if (timeHHMM >= "15:30" && timeHHMM < "23:30") return 2;
    return 3;
  };
  const currentShift = getCurrentShift();

  useEffect(() => {
    const fetchPresses = async () => {
      try {
        const response = await fetch("http://localhost:8080/internal/forge_lines");
        const data = await response.json();
        if (Array.isArray(data) && data[0]?.forge_lines) {
          setPresses(data[0].forge_lines);
        }
      } catch (error) {
        console.error("Error fetching press list:", error);
      }
    };
    fetchPresses();
    fetchSavedData(filterDate);
  }, []);

  const fetchSavedData = async (date) => {
    try {
      const response = await fetch(`http://localhost:8080/internal/die_selection?created_at=${date}`);
      const result = await response.json();
      setSavedData(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Error fetching saved data");
    }
  };

  // 🆕 Toast handler
  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 3000);
  };

  const fetchDieData = async (pressId, dieNumber) => {
    try {
      const response = await fetch(
        `http://localhost:8080/internal/stroke_selection?die_number=${dieNumber}`
      );
      const result = await response.json();

      if (Array.isArray(result) && result.length > 0) {
        setResults((prev) => ({ ...prev, [pressId]: result[0] }));
        setSavedPresses((prev) => ({ ...prev, [pressId]: false }));
      } else {
        showToast("❌ Die number not found.");
      }
    } catch (error) {
      showToast("⚠️ Error fetching data");
    }
  };

  const handleSubmit = (e, pressId) => {
    e.preventDefault();
    const dieNumber = dieNumbers[pressId];
    if (dieNumber && /^[0-9]{1,4}$/.test(dieNumber)) {
      fetchDieData(pressId, dieNumber.trim());
    } else {
      showToast("🔢 Die Number must be up to 4 digits.");
    }
  };



  const handleSave = async (pressId) => {
    if (!results[pressId]) {
      showToast("⚠ Please fetch Die data first.");
      return;
    }

    const payload = {
      die_number: results[pressId].die_number,
      plant_code: results[pressId].plant_code,
      forge_press: presses[pressId],
      cut_wt: results[pressId].cut_wt,
      net_wt: results[pressId].net_wt,
      forge_stroke_selection: results[pressId].forge_stroke_selection,
      trim_stroke_selection: results[pressId].trim_stroke_selection,
    };

    try {
        const authOptions = await getAuthHeadersWithCSRF("POST");
      const response = await fetch("http://localhost:8080/internal/stroke_selection", {
        method: "POST",
        ...authOptions,
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.status === "created") {
        showToast("✔ Record saved successfully!");
        setSavedPresses((prev) => ({ ...prev, [pressId]: true }));
        fetchSavedData(filterDate);
      } else if (result.status === "already_saved") {
        showToast("ℹ Record already saved earlier.");
        setSavedPresses((prev) => ({ ...prev, [pressId]: true }));
      } else {
        showToast("❌ Save failed: " + (result.message || "Unknown error"));
      }
    } catch (error) {
      showToast("⚠ Error saving record");
    }
  };

  // ❌ Close result function
  const closeResult = (pressId) => {
    setResults((prev) => {
      const updated = { ...prev };
      delete updated[pressId];
      return updated;
    });
    setSavedPresses((prev) => {
      const updated = { ...prev };
      delete updated[pressId];
      return updated;
    });
  };

  return (
    <div style={{ padding: "20px" }}>
      {/* 🆕 Toast Notification */}
      {toastMessage && (
        <div style={styles.toast} className="toast-popup">
          {toastMessage}
        </div>
      )}

      {/* 🔁 Tabs */}
      <div style={{ display: "flex", marginBottom: "15px" }}>
        <button
          onClick={() => setActiveTab("selection")}
          style={activeTab === "selection" ? styles.activeTab : styles.tab}
        >
          Stroke Selection
        </button>
        <button
          onClick={() => setActiveTab("saved")}
          style={activeTab === "saved" ? styles.activeTab : styles.tab}
        >
          Saved Records
        </button>
      </div>

      {activeTab === "selection" && (
        <>
          <h1 style={{ textAlign: "center" }}>Forging Press Stroke Selection</h1>
          <div style={styles.cardContainer}>
            {presses.map((press, pressId) => (
              <div key={pressId} style={{ ...styles.card, ...(results[pressId] ? styles.cardHover : {}) }}>
                <h2 style={styles.title}>{press}</h2>

                {/* Form */}
                <form onSubmit={(e) => handleSubmit(e, pressId)} style={styles.form}>
                  <input
                    type="text"
                    placeholder="Enter Die Number"
                    value={dieNumbers[pressId] || ""}
                    onChange={(e) =>
                      setDieNumbers((prev) => ({ ...prev, [pressId]: e.target.value.replace(/[^0-9]/g, "") }))
                    }
                    style={styles.input}
                    maxLength={4}
                    required
                  />
                  <button type="submit" style={styles.button}>Search</button>
                </form>

                {/* Saved Die Numbers */}
                {Array.isArray(savedData) && savedData.filter(
                  (row) => row.forge_press === press && String(row.shift) === String(currentShift)
                ).length > 0 && (
                  <div style={styles.savedInfo}>
                    <p style={{ fontWeight: "600", marginBottom: "2px" }}>Saved in Shift {currentShift}:</p>
                    <div style={styles.savedTags}>
                      {savedData.filter((row) => row.forge_press === press && String(row.shift) === String(currentShift)).map((row, idx) => (
                        <span key={idx} style={styles.badge}>{row.die_number}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Result Card */}
                {results[pressId] && (
                  <div style={{ position: "relative" }}>
                    {/* ❌ Close Button */}
                    <button
                      onClick={() => closeResult(pressId)}
                      style={{
                        position: "absolute",
                        top: "-10px",
                        right: "-10px",
                        background: "#ef4444",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: "26px",
                        height: "26px",
                        cursor: "pointer",
                        fontWeight: "bold",
                        boxShadow: "0px 2px 5px rgba(0,0,0,0.2)",
                      }}
                      title="Close"
                    >
                      ×
                    </button>

                    <table style={styles.table}>
                      <tbody>
                        <tr><td style={styles.th2}>Die Number</td><td style={styles.td2}>{results[pressId].die_number}</td></tr>
                        <tr><td style={styles.th2}>Cut Weight</td><td style={styles.td2}>{results[pressId].cut_wt}</td></tr>
                        <tr><td style={styles.th2}>Net Weight</td><td style={styles.td2}>{results[pressId].net_wt}</td></tr>
                        <tr><td style={styles.th2}>Forge Stroke</td><td style={styles.td2}>{results[pressId].forge_stroke_selection}</td></tr>
                        <tr><td style={styles.th2}>Trim Stroke</td><td style={styles.td2}>{results[pressId].trim_stroke_selection}</td></tr>
                      </tbody>
                    </table>

                    <button
                      style={{ ...styles.saveButton, ...(savedPresses[pressId] && { background: "#9ca3af", cursor: "not-allowed" }) }}
                      onClick={() => !savedPresses[pressId] && handleSave(pressId)}
                      disabled={savedPresses[pressId]}
                    >
                      {savedPresses[pressId] ? "Saved ✔" : "Save"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Saved Data */}
      {activeTab === "saved" && (
        <>
          <h2>📁 Saved Records</h2>
          <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => {
                setFilterDate(e.target.value);
                fetchSavedData(e.target.value);
              }}
              style={{ padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
          </div>

          {savedData.length === 0 ? (
            <p>No records found for this date.</p>
          ) : (
            Object.keys(savedData.reduce((acc, row) => { acc[row.shift] = true; return acc; }, {})).map((shift) => (
              <div key={shift} style={{ marginBottom: "25px" }}>
                <h3 style={{ background: "#d1d5db", padding: "8px", borderRadius: "6px", textAlign: "center", fontWeight: "600" }}>
                  Shift {shift}
                </h3>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th2}>Die No</th>
                      <th style={styles.th2}>Press</th>
                      <th style={styles.th2}>Cut Weight</th>
                      <th style={styles.th2}>Net Weight</th>
                      <th style={styles.th2}>Forge Stroke</th>
                      <th style={styles.th2}>Trim Stroke</th>
                      <th style={styles.th2}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedData
                      .filter((row) => String(row.shift) === String(shift))
                      .map((row, index) => (
                        <tr key={index}>
                          <td style={styles.td2}>{row.die_number}</td>
                          <td style={styles.td2}>{row.forge_press}</td>
                          <td style={styles.td2}>{row.cut_wt}</td>
                          <td style={styles.td2}>{row.net_wt}</td>
                          <td style={styles.td2}>{row.forge_stroke_selection}</td>
                          <td style={styles.td2}>{row.trim_stroke_selection}</td>
                          <td style={styles.td2}>{row.created_at}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;

/* 🎨 Styling */
const styles = {
  tab: { flex: 1, padding: "10px", cursor: "pointer", borderRadius: "6px", border: "1px solid #d1d5db", background: "#f3f4f6", textAlign: "center" },
  activeTab: { flex: 1, padding: "10px", cursor: "pointer", borderRadius: "6px", border: "1px solid #60a5fa", background: "#93c5fd", textAlign: "center", color: "#1e3a8a", fontWeight: "600" },
  cardContainer: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "20px" },
  card: { padding: "20px", background: "#f9fafb", borderRadius: "12px", boxShadow: "0px 2px 8px rgba(0,0,0,0.08)", border: "1px solid #d1d5db", transition: "0.3s" },
  cardHover: { borderColor: "#60a5fa", boxShadow: "0 4px 14px rgba(96,165,250,0.3)" },
  input: { flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" },
  button: { background: "#93c5fd", color: "#1e3a8a", padding: "8px 12px", borderRadius: "6px", border: "none", cursor: "pointer" },
  table: { marginTop: "12px", width: "100%", borderCollapse: "collapse" },
  th2: { padding: "6px", background: "#f1f5f9", border: "1px solid #e5e7eb", fontWeight: "600" },
  td2: { padding: "6px", background: "#ffffff", border: "1px solid #e5e7eb" },
  saveButton: { marginTop: "15px", width: "100%", padding: "10px", background: "#93c5fd", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "600" },
  toast: {
    position: "fixed",
    top: "20px",
    left: "50%",
    background: "#4ADE80",
    color: "#064E3B",
    padding: "10px 16px",
    borderRadius: "8px",
    boxShadow: "0px 4px 12px rgba(0,0,0,0.15)",
    fontSize: "14px",
    fontWeight: "600",
    zIndex: 9999,
    animation: "slideUpFade 3s forwards",
  },
  savedInfo: { marginTop: "8px", fontSize: "12px", color: "#374151" },
  savedTags: { display: "flex", gap: "5px", flexWrap: "wrap" },
  badge: { background: "#dbeafe", color: "#1e3a8a", padding: "3px 8px", borderRadius: "6px", border: "1px solid #93c5fd", fontSize: "12px" },

};
