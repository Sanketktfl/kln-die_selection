import React, { useState, useEffect, useRef } from "react";
import "./dashboard.css";
import { FiEdit } from "react-icons/fi";
import { MdDelete } from "react-icons/md";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState("selection");
  const [presses, setPresses] = useState([]);
  const [dieNumbers, setDieNumbers] = useState({});
  const [results, setResults] = useState({});
  const [savedPresses, setSavedPresses] = useState({});
  const [savedData, setSavedData] = useState([]);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split("T")[0]);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState("success");
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const [editRow, setEditRow] = useState(null);
  const [editFields, setEditFields] = useState({});

  const [dieChangeConfirm, setDieChangeConfirm] = useState(null);
  const [snapshotResult, setSnapshotResult] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const lastCarryShiftRef = useRef(null);

  const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
  };

  const getAuthHeadersWithCSRF = async () => {
    const credentials = btoa("caddok:Concali4raj2024$");
    await fetch("https://ktfrancesrv1.kalyanicorp.com/internal/forge_liness", {
      method: "GET",
      headers: { Authorization: `Basic ${credentials}` },
      credentials: "include",
    });
    const csrfToken = getCookie("CSRFToken");
    if (!csrfToken) throw new Error("CSRF token not found in cookies.");
    return {
      headers: {
        Authorization: `Basic ${credentials}`,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      credentials: "include",
    };
  };

  const getCurrentShift = () => {
    const now = new Date();
    const timeHHMM = now.toTimeString().slice(0, 5);
    if (timeHHMM >= "07:30" && timeHHMM < "15:30") return 1;
    if (timeHHMM >= "15:30" && timeHHMM < "23:30") return 2;
    return 3;
  };
  const currentShift = getCurrentShift();

  const showToast = (message, type = "success") => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => setToastMessage(""), 3500);
  };

  const fetchSavedData = async (date) => {
    try {
      const response = await fetch(
        `https://ktfrancesrv1.kalyanicorp.com/internal/die_selection?created_at=${date}`
      );
      const result = await response.json();
      const fresh = Array.isArray(result) ? result : [];
      setSavedData(fresh);
      return fresh;
    } catch (error) {
      console.error("Error fetching saved data");
      return [];
    }
  };

  const runCarryForward = async (forgeLines, currentDate) => {
    if (!forgeLines || forgeLines.length === 0) return;
    if (lastCarryShiftRef.current === currentShift) return;
    lastCarryShiftRef.current = currentShift;

    try {
      const authOptions = await getAuthHeadersWithCSRF();
      const response = await fetch(
        "https://ktfrancesrv1.kalyanicorp.com/internal/die_selection",
        {
          method: "POST",
          ...authOptions,
          body: JSON.stringify({ forge_lines: forgeLines }),
        }
      );
      const result = await response.json();

      if (result.status === "done") {
        await fetchSavedData(currentDate);

        if (result.carried_forward?.length > 0) {
          const names = result.carried_forward
            .map((c) => `${c.press}: Die ${c.die_number}`)
            .join(", ");
          showToast(`↩ Carried from prev shift — ${names}`, "info");
        }

        if (result.errors?.length > 0) {
          const errPresses = result.errors.map((e) => e.press).join(", ");
          showToast(`⚠️ Carry-forward failed for: ${errPresses} — check opcua_log.txt`, "error");
          console.error("Carry-forward errors:", result.errors);
        }
      }
    } catch (err) {
      console.error("Carry-forward error:", err);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const response = await fetch(
          "https://ktfrancesrv1.kalyanicorp.com/internal/forge_liness"
        );
        const data = await response.json();
        if (Array.isArray(data) && data[0]?.forge_lines) {
          const lines = data[0].forge_lines;
          setPresses(lines);
          await fetchSavedData(filterDate);
          await runCarryForward(lines, filterDate);
        }
      } catch (error) {
        console.error("Error during init:", error);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDieData = async (pressId, dieNumber) => {
    try {
      const response = await fetch(
        `https://ktfrancesrv1.kalyanicorp.com/internal/stroke_selection?die_number=${dieNumber}`
      );
      const result = await response.json();
      if (Array.isArray(result) && result.length > 0) {
        setResults((prev) => ({ ...prev, [pressId]: result[0] }));
        setSavedPresses((prev) => ({ ...prev, [pressId]: false }));
      } else {
        showToast("❌ Die number not found.", "error");
      }
    } catch (error) {
      showToast("⚠️ Error fetching data", "error");
    }
  };

  const getShiftDieCountForPress = (pressName) => {
    return savedData.filter(
      (row) =>
        row.forge_press === pressName &&
        String(row.shift) === String(currentShift)
    ).length;
  };

  const handleSubmit = async (e, pressId) => {
    e.preventDefault();
    const dieNumber = dieNumbers[pressId];
    if (!dieNumber || !/^[0-9]{1,4}$/.test(dieNumber)) {
      showToast("🔢 Die Number must be up to 4 digits.", "error");
      return;
    }
    fetchDieData(pressId, dieNumber.trim());
  };

  const handleDieChangeConfirmed = async () => {
  if (!dieChangeConfirm) return;
  const { pressId, pressName } = dieChangeConfirm;

  setSnapshotLoading(true);
  setSnapshotResult(null);

  try {
    const authOptions = await getAuthHeadersWithCSRF();

    // ── STEP 1: GET live counter from HMI ──
    const credentials = btoa("caddok:Concali4raj2024$");
    const getResponse = await fetch(
      `https://ktfrancesrv1.kalyanicorp.com/internal/forge_stroke_counter?press=${encodeURIComponent(pressName)}`,
      { method: "GET", headers: { Authorization: `Basic ${credentials}` }, credentials: "include" }
    );
    const getResult = await getResponse.json();

    if (getResult.status !== "ok") {
      showToast("⚠️ HMI read failed — saving without counter: " + (getResult.message || ""), "error");
    } else {
      const counterValue = getResult.forge_stroke_counter;

      // ── STEP 2: POST to get previous die's cdb_object_id + net_wt ──
      const prevResponse = await fetch(
        "https://ktfrancesrv1.kalyanicorp.com/internal/forge_stroke_counter",
        {
          method: "POST",
          ...authOptions,
          body: JSON.stringify({ press: pressName }),
        }
      );
      const prevResult = await prevResponse.json();

      if (prevResult.status === "ok") {
        // ── STEP 3: Calculate tonnage and PUT directly to CDB REST API ──
        const tonnage = prevResult.net_wt != null
          ? Math.round(counterValue * prevResult.net_wt * 1000) / 1000
          : null;

        const encodedDate = prevResult.created_at.replace(" ", "T").replace(/:/g, "~3A");
        const atId = `https://ktfrancesrv1.kalyanicorp.com/api/v1/collection/kln_die_selection/${prevResult.die_number}@${prevResult.plant_code}@${pressName}@${encodedDate}`;

        const putPayload = { forge_stroke_counter: counterValue };
        if (tonnage !== null) putPayload.tonnage = tonnage;

        const putRes = await fetch(atId, {
          method: "PUT",
          ...authOptions,
          body: JSON.stringify(putPayload),
        });

        if (putRes.ok) {
          const tonnageMsg = tonnage != null ? ` | Tonnage: ${tonnage} kg` : "";
          showToast(`📸 Counter ${counterValue} saved for Die ${prevResult.die_number}${tonnageMsg}`, "info");
        } else {
          showToast("⚠️ Counter saved but DB update failed: " + putRes.status, "error");
        }

      } else if (prevResult.status === "no_previous_die") {
        showToast("ℹ No previous die found — proceeding to save.", "info");
      } else {
        showToast("⚠️ Could not get previous die info — saving anyway.", "error");
      }
    }

  } catch (err) {
    showToast("⚠️ Error — saving new die anyway.", "error");

  } finally {
    // ── STEP 4: Always save new die ──
    await doSave(pressId, pressName);
    setSnapshotLoading(false);
    setDieChangeConfirm(null);
  }
};

  const closeResult = (pressId) => {
    setResults((prev) => { const u = { ...prev }; delete u[pressId]; return u; });
    setDieNumbers((prev) => ({ ...prev, [pressId]: "" }));
    setSavedPresses((prev) => { const u = { ...prev }; delete u[pressId]; return u; });
  };

  const handleSave = async (pressId, pressName) => {
    if (!results[pressId]) { showToast("⚠ Please fetch Die data first.", "error"); return; }

    const existingCount = getShiftDieCountForPress(pressName);

    if (existingCount >= 1) {
      setDieChangeConfirm({ pressId, pressName });
      setSnapshotResult(null);
      return;
    }

    await doSave(pressId, pressName);
  };

  const doSave = async (pressId, pressName) => {
    if (!results[pressId]) return;
    const payload = {
      die_number: results[pressId].die_number,
      plant_code: results[pressId].plant_code,
      forge_press: pressName,
      cut_wt: results[pressId].cut_wt,
      net_wt: results[pressId].net_wt,
      forge_stroke_selection: results[pressId].forge_stroke_selection,
      trim_stroke_selection: results[pressId].trim_stroke_selection,
    };
    try {
      const authOptions = await getAuthHeadersWithCSRF();
      const response = await fetch(
        "https://ktfrancesrv1.kalyanicorp.com/internal/stroke_selection",
        { method: "POST", ...authOptions, body: JSON.stringify(payload) }
      );
      const result = await response.json();
      if (result.status === "created") {
        showToast("✔ Record saved successfully!", "success");
        setSavedPresses((prev) => ({ ...prev, [pressId]: true }));
        fetchSavedData(filterDate);
      } else if (result.status === "already_saved") {
        showToast("ℹ Record already saved earlier.", "info");
        setSavedPresses((prev) => ({ ...prev, [pressId]: true }));
      } else {
        showToast("❌ Save failed: " + (result.message || "Unknown error"), "error");
      }
    } catch (error) {
      showToast("⚠ Error saving record", "error");
    }
  };

  const handleDelete = async (row) => {
    try {
      const authOptions = await getAuthHeadersWithCSRF();
      const encodedDate = row.created_at.replace(" ", "T").replace(/:/g, "~3A");
      const atId = `https://ktfrancesrv1.kalyanicorp.com/api/v1/collection/kln_die_selection/${row.die_number}@${row.plant_code}@${row.forge_press}@${encodedDate}`;
      const deleteRes = await fetch(atId, { method: "DELETE", ...authOptions });
      if (deleteRes.ok) {
        showToast("🗑 Record deleted successfully.", "success");
        fetchSavedData(filterDate);
      } else {
        showToast("❌ Delete failed: " + deleteRes.status, "error");
      }
    } catch (error) {
      showToast("⚠ Error: " + error.message, "error");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const openEdit = (row) => {
    setEditRow(row);
    setEditFields({
      cut_wt: row.cut_wt ?? "",
      net_wt: row.net_wt ?? "",
      forge_stroke_selection: row.forge_stroke_selection ?? "",
      trim_stroke_selection: row.trim_stroke_selection ?? "",
    });
  };

  const handleEdit = async () => {
    if (!editRow) return;
    try {
      const authOptions = await getAuthHeadersWithCSRF();
      const encodedDate = editRow.created_at.replace(" ", "T").replace(/:/g, "~3A");
      const atId = `https://ktfrancesrv1.kalyanicorp.com/api/v1/collection/kln_die_selection/${editRow.die_number}@${editRow.plant_code}@${editRow.forge_press}@${encodedDate}`;
      const payload = {};
      if (editFields.cut_wt !== "") payload.cut_wt = Number(editFields.cut_wt);
      if (editFields.net_wt !== "") payload.net_wt = Number(editFields.net_wt);
      if (editFields.forge_stroke_selection !== "") payload.forge_stroke_selection = Number(editFields.forge_stroke_selection);
      if (editFields.trim_stroke_selection !== "") payload.trim_stroke_selection = Number(editFields.trim_stroke_selection);

      const putRes = await fetch(atId, {
        method: "PUT",
        ...authOptions,
        body: JSON.stringify(payload),
      });

      if (putRes.ok) {
        showToast("✏ Record updated successfully.", "success");
        fetchSavedData(filterDate);
      } else {
        const errText = await putRes.text();
        console.error("Edit failed:", errText);
        showToast("❌ Update failed: " + putRes.status, "error");
      }
    } catch (error) {
      showToast("⚠ Error: " + error.message, "error");
    } finally {
      setEditRow(null);
      setEditFields({});
    }
  };

  const toastBg = {
    success: { background: "#4ADE80", color: "#064E3B" },
    error:   { background: "#FCA5A5", color: "#7F1D1D" },
    info:    { background: "#93C5FD", color: "#1E3A8A" },
  }[toastType] || { background: "#4ADE80", color: "#064E3B" };

  return (
    <div style={{ padding: "20px" }}>

      {/* Toast */}
      {toastMessage && (
        <div style={{ ...styles.toast, ...toastBg }} className="toast-popup">
          {toastMessage}
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <h3 style={{ marginBottom: "10px", color: "#1f2937" }}>Confirm Delete</h3>
            <p style={{ color: "#374151", marginBottom: "6px" }}>Are you sure you want to delete this record?</p>
            <div style={styles.modalMeta}>
              <span><b>Die:</b> {deleteConfirm.die_number}</span>
              <span><b>Press:</b> {deleteConfirm.forge_press}</span>
              <span><b>Shift:</b> {deleteConfirm.shift}</span>
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button style={styles.confirmDeleteBtn} onClick={() => handleDelete(deleteConfirm)}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editRow && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <h3 style={{ marginBottom: "6px", color: "#1f2937" }}>✏ Edit Record</h3>
            <div style={styles.modalMeta}>
              <span><b>Die:</b> {editRow.die_number}</span>
              <span><b>Press:</b> {editRow.forge_press}</span>
              <span><b>Shift:</b> {editRow.shift}</span>
            </div>
            <div style={styles.editGrid}>
              {[
                { key: "cut_wt",                 label: "Cut Weight" },
                { key: "net_wt",                 label: "Net Weight" },
                { key: "forge_stroke_selection", label: "Forge Stroke" },
                { key: "trim_stroke_selection",  label: "Trim Stroke" },
              ].map(({ key, label }) => (
                <div key={key} style={styles.editField}>
                  <label style={styles.editLabel}>{label}</label>
                  <input
                    type="text"
                    value={editFields[key]}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={styles.editInput}
                  />
                </div>
              ))}
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setEditRow(null)}>Cancel</button>
              <button style={styles.confirmEditBtn} onClick={handleEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Die Change Confirmation Modal ── */}
      {dieChangeConfirm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={styles.dieChangeHeader}>
              <span style={styles.dieChangeIcon}>🔄</span>
              <h3 style={{ margin: 0, color: "#1f2937", fontSize: "17px" }}>
                Change Die on {dieChangeConfirm.pressName}?
              </h3>
            </div>
            <div style={styles.dieChangeInfoBanner}>
              <span style={{ fontSize: "18px" }}>⚙️</span>
              <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: "1.5" }}>
                A die is <b>already active</b> for this press in{" "}
                <b>Shift {currentShift}</b>.<br />
                Confirming will:
              </p>
            </div>
            <div style={styles.dieChangeSteps}>
              <div style={styles.dieChangeStep}>
                <span style={styles.stepNum}>1</span>
                <span>Read the <b>live forge stroke counter</b> from the HMI for <b>{dieChangeConfirm.pressName}</b></span>
              </div>
              <div style={styles.dieChangeStep}>
                <span style={styles.stepNum}>2</span>
                <span>Save that counter value to the <b>current die's record</b></span>
              </div>
              <div style={styles.dieChangeStep}>
                <span style={styles.stepNum}>3</span>
                <span>Add the <b>new die</b> you just entered</span>
              </div>
            </div>
            {snapshotLoading && (
              <div style={styles.snapshotLoading}>
                <div style={styles.spinner} />
                <span style={{ fontSize: "13px", color: "#6b7280" }}>Reading HMI counter…</span>
              </div>
            )}
            <div style={styles.modalActions}>
              <button
                style={styles.cancelBtn}
                onClick={() => { setDieChangeConfirm(null); setSnapshotResult(null); }}
                disabled={snapshotLoading}
              >
                Cancel
              </button>
              <button
                style={{ ...styles.confirmDieChangeBtn, ...(snapshotLoading ? { opacity: 0.6, cursor: "not-allowed" } : {}) }}
                onClick={handleDieChangeConfirmed}
                disabled={snapshotLoading}
              >
                {snapshotLoading ? "Processing…" : "Yes, Change Die"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", marginBottom: "15px" }}>
        <button onClick={() => setActiveTab("selection")} style={activeTab === "selection" ? styles.activeTab : styles.tab}>
          Die Selection
        </button>
        <button onClick={() => setActiveTab("saved")} style={activeTab === "saved" ? styles.activeTab : styles.tab}>
          Saved Records
        </button>
      </div>

      {/* ── Die Selection Tab ── */}
      {activeTab === "selection" && (
        <>
          <h1 style={{ textAlign: "center" }}>Forging Press Die Selection</h1>
          <div style={styles.cardContainer}>
            {presses.map((press, pressId) => {

              const currentShiftDies = savedData.filter(
                (row) =>
                  row.forge_press === press &&
                  String(row.shift) === String(currentShift)
              );
              const hasMultipleDies = currentShiftDies.length >= 1;

              return (
                <div key={pressId} style={{ ...styles.card, ...(results[pressId] ? styles.cardHover : {}) }}>
                  <h2 style={styles.title}>{press}</h2>

                  <form onSubmit={(e) => handleSubmit(e, pressId)} style={styles.form}>
                    <input
                      type="text"
                      placeholder="Enter Die Number"
                      value={dieNumbers[pressId] || ""}
                      onChange={(e) =>
                        setDieNumbers((prev) => ({
                          ...prev,
                          [pressId]: e.target.value.replace(/[^0-9]/g, ""),
                        }))
                      }
                      style={styles.input}
                      maxLength={4}
                      required
                    />
                    <button type="submit" style={styles.button}>Search</button>
                  </form>

                  {currentShiftDies.length > 0 && (
                    <div style={styles.savedInfo}>
                      <p style={{ fontWeight: "600", marginBottom: "4px" }}>
                        Shift {currentShift} — Active Dies:
                      </p>
                      <div style={styles.savedTags}>
                        {currentShiftDies.map((row, idx) => (
                          <span key={idx} style={{
                            ...styles.badge,
                            ...(row.forge_stroke_counter != null ? styles.badgeWithCounter : {}),
                          }}>
                            🔧 {row.die_number}
                            {row.forge_stroke_counter != null && (
                              <span style={styles.counterChip}>
                                📊 {row.forge_stroke_counter} strokes
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                      {hasMultipleDies && (
                        <div style={styles.multiDieWarning}>
                          ⚡ Adding another die will snapshot the HMI counter
                        </div>
                      )}
                    </div>
                  )}

                  {results[pressId] && (
                    <div style={styles.resultBox}>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
                        <button type="button" onClick={() => closeResult(pressId)} style={styles.closeBtn} title="Close">✕</button>
                      </div>
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
                        type="button"
                        style={{ ...styles.saveButton, ...(savedPresses[pressId] ? { background: "#9ca3af", cursor: "not-allowed" } : {}) }}
                        onClick={() => !savedPresses[pressId] && handleSave(pressId, press)}
                        disabled={savedPresses[pressId]}
                      >
                        {savedPresses[pressId] ? "Saved ✔" : "Save"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Saved Records Tab ── */}
      {activeTab === "saved" && (
        <>
          <h2>📁 Saved Records</h2>
          <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => { setFilterDate(e.target.value); fetchSavedData(e.target.value); }}
              style={{ padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
          </div>

          {savedData.length === 0 ? (
            <p>No records found for this date.</p>
          ) : (
            Object.keys(savedData.reduce((acc, row) => { acc[row.shift] = true; return acc; }, {}))
              .map((shift) => (
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
                        <th style={styles.th2}>HMI Counter</th>
                        <th style={styles.th2}>Tonnage (kg)</th>
                        <th style={styles.th2}>Time</th>
                        <th style={styles.th2}>Actions</th>
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
                            <td style={{
                              ...styles.td2,
                              fontWeight: row.forge_stroke_counter != null ? "700" : "400",
                              color: row.forge_stroke_counter != null ? "#1d4ed8" : "#9ca3af",
                              textAlign: "center",
                            }}>
                              {row.forge_stroke_counter ?? "—"}
                            </td>
                            <td style={{
                              ...styles.td2,
                              fontWeight: row.tonnage != null ? "700" : "400",
                              color: row.tonnage != null ? "#065f46" : "#9ca3af",
                              textAlign: "center",
                            }}>
                              {row.tonnage ?? "—"}
                            </td>
                            <td style={styles.td2}>{row.created_at}</td>
                            <td style={{ ...styles.td2, textAlign: "center" }}>
                              <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                                <button style={styles.editBtn} onClick={() => openEdit(row)} title="Edit">
                                  <FiEdit />
                                </button>
                                <button style={styles.deleteBtn} onClick={() => setDeleteConfirm(row)} title="Delete">
                                  <MdDelete />
                                </button>
                              </div>
                            </td>
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

const styles = {
  tab: { flex: 1, padding: "10px", cursor: "pointer", borderRadius: "6px", border: "1px solid #d1d5db", background: "#f3f4f6", textAlign: "center" },
  activeTab: { flex: 1, padding: "10px", cursor: "pointer", borderRadius: "6px", border: "1px solid #60a5fa", background: "#93c5fd", textAlign: "center", color: "#1e3a8a", fontWeight: "600" },
  cardContainer: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "20px" },
  card: { padding: "20px", background: "#f9fafb", borderRadius: "12px", boxShadow: "0px 2px 8px rgba(0,0,0,0.08)", border: "1px solid #d1d5db", transition: "0.3s", overflow: "visible" },
  cardHover: { borderColor: "#60a5fa", boxShadow: "0 4px 14px rgba(96,165,250,0.3)" },
  form: { display: "flex", gap: "8px", marginTop: "8px" },
  input: { flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" },
  button: { background: "#93c5fd", color: "#1e3a8a", padding: "8px 12px", borderRadius: "6px", border: "none", cursor: "pointer" },
  resultBox: { marginTop: "12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "10px" },
  closeBtn: { background: "#ef4444", color: "white", border: "none", borderRadius: "50%", width: "26px", height: "26px", cursor: "pointer", fontWeight: "bold", fontSize: "14px", boxShadow: "0px 2px 5px rgba(0,0,0,0.2)" },
  table: { width: "100%", borderCollapse: "collapse" },
  th2: { padding: "6px", background: "#f1f5f9", border: "1px solid #e5e7eb", fontWeight: "600" },
  td2: { padding: "6px", background: "#ffffff", border: "1px solid #e5e7eb" },
  saveButton: { marginTop: "10px", width: "100%", padding: "10px", background: "#93c5fd", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "600" },
  toast: { position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)", padding: "10px 16px", borderRadius: "8px", boxShadow: "0px 4px 12px rgba(0,0,0,0.15)", fontSize: "14px", fontWeight: "600", zIndex: 9999, animation: "slideUpFade 3s forwards" },
  savedInfo: { marginTop: "8px", fontSize: "12px", color: "#374151" },
  savedTags: { display: "flex", gap: "5px", flexWrap: "wrap" },
  badge: { background: "#dbeafe", color: "#1e3a8a", padding: "3px 8px", borderRadius: "6px", border: "1px solid #93c5fd", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
  badgeWithCounter: { background: "#ede9fe", borderColor: "#a78bfa", color: "#4c1d95" },
  counterChip: { background: "#c7d2fe", color: "#3730a3", borderRadius: "4px", padding: "1px 5px", fontSize: "11px", fontWeight: "700" },
  multiDieWarning: { marginTop: "6px", fontSize: "11px", color: "#b45309", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "5px", padding: "3px 8px", display: "inline-block" },
  editBtn: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "16px", fontWeight: "600" },
  deleteBtn: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "16px", fontWeight: "600" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 },
  modalBox: { background: "#fff", borderRadius: "12px", padding: "28px 32px", boxShadow: "0 8px 30px rgba(0,0,0,0.2)", minWidth: "340px", maxWidth: "460px", width: "100%" },
  modalMeta: { display: "flex", gap: "14px", flexWrap: "wrap", background: "#f1f5f9", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#374151" },
  modalActions: { display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "20px" },
  cancelBtn: { padding: "8px 18px", borderRadius: "6px", border: "1px solid #d1d5db", background: "#f3f4f6", cursor: "pointer", fontWeight: "600" },
  confirmDeleteBtn: { padding: "8px 18px", borderRadius: "6px", border: "none", background: "#ef4444", color: "white", cursor: "pointer", fontWeight: "600" },
  confirmEditBtn: { padding: "8px 18px", borderRadius: "6px", border: "none", background: "#3b82f6", color: "white", cursor: "pointer", fontWeight: "600" },
  confirmDieChangeBtn: { padding: "8px 18px", borderRadius: "6px", border: "none", background: "#f59e0b", color: "white", cursor: "pointer", fontWeight: "600" },
  editGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "4px" },
  editField: { display: "flex", flexDirection: "column", gap: "4px" },
  editLabel: { fontSize: "12px", fontWeight: "600", color: "#374151" },
  editInput: { padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" },
  dieChangeHeader: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" },
  dieChangeIcon: { fontSize: "24px" },
  dieChangeInfoBanner: { display: "flex", gap: "10px", alignItems: "flex-start", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "10px 14px", marginBottom: "14px" },
  dieChangeSteps: { display: "flex", flexDirection: "column", gap: "8px", marginBottom: "4px" },
  dieChangeStep: { display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "13px", color: "#374151", lineHeight: "1.5" },
  stepNum: { minWidth: "22px", height: "22px", background: "#3b82f6", color: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700", flexShrink: 0 },
  snapshotLoading: { display: "flex", alignItems: "center", gap: "10px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "10px", marginTop: "12px" },
  spinner: { width: "18px", height: "18px", border: "3px solid #bae6fd", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 },
  title: { marginTop: 0 },
};