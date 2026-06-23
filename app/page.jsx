"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DB_NAME = "cloth_try_on_db";
const DB_VERSION = 1;

const CATEGORIES = {
  top: "上衣",
  bottom: "下装",
  outerwear: "外套",
  shoes: "鞋",
  accessory: "配饰"
};

const EXCLUSIVE_CATEGORIES = new Set(["top", "bottom", "outerwear", "shoes"]);

const OCCASION_PRESETS = ["周末休闲", "通勤", "约会", "旅行", "正式场合", "运动", "聚会"];

const ITEM_QUALITY = {
  normal: { label: "正常", tone: "neutral" },
  good: { label: "好用", tone: "good" },
  retake: { label: "待重拍", tone: "warning" },
  blocked: { label: "禁用生成", tone: "danger" }
};

const DEFAULT_PROMPT =
  [
    "IMAGE ROLES:",
    "- Image 1 (first image): IDENTITY REFERENCE - this is the person who must appear in the output. Preserve their exact face, skin tone, hair, and body type.",
    "- Images 2+: CLOTHING REFERENCES - these are the garments to dress the person in.",
    "",
    "TASK:",
    "Generate a single photorealistic full-body photo of the EXACT person from Image 1, wearing the clothing items shown in the subsequent images.",
    "",
    "CRITICAL REQUIREMENTS (ranked by priority):",
    "1. FACE IDENTITY: The output person must be recognizably the same individual as Image 1. Same facial structure, eyes, nose, mouth, skin tone, and hair style. This is the #1 priority - do NOT replace or alter the person.",
    "2. CLOTHING ACCURACY: Dress the person in the exact garments from the reference images. Match colors, patterns, fit, and style precisely.",
    "3. NATURAL INTEGRATION: Clothing should drape naturally on the person's body with realistic wrinkles, shadows, and fabric behavior.",
    "4. PHOTO QUALITY: Clean, well-lit, natural-looking photo. Simple neutral background unless otherwise specified.",
    "",
    "AVOID:",
    "- Do NOT use a different person or model.",
    "- Do NOT change the person's face, ethnicity, age, or body proportions.",
    "- Do NOT add accessories or clothing not shown in the references."
  ].join("\n");

const LEGACY_STABLE_PROMPT =
  "A photorealistic candid smartphone photo of the original person naturally wearing the newly selected outfit, including the top, pants, and shoes. Strictly maintain the subject's exact facial features, body proportions, and original pose. Seamless clothing integration with natural fabric draping, realistic wrinkles, and correct gravity. Perfectly match the ambient lighting, shadows, and background of the original scene. High resolution, sharp focus on the clothing, shot on a modern mobile phone.";

const DEFAULT_SETTINGS = {
  endpoint: "/api/generate",
  provider: "gemini",
  mongoDb: ""
};

export default function Home() {
  const dbRef = useRef(null);
  const backupFileRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("closet");
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [selection, setSelection] = useState([]);
  const [assetUrls, setAssetUrls] = useState({});
  const [modelAssetId, setModelAssetId] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyOnlyFavorites, setHistoryOnlyFavorites] = useState(false);
  const [occasion, setOccasion] = useState("周末休闲");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [weatherCity, setWeatherCity] = useState("");
  const [weatherDate, setWeatherDate] = useState(todayInputValue());
  const [weatherInfo, setWeatherInfo] = useState(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState([]);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState("");
  const [savedOutfits, setSavedOutfits] = useState([]);
  const [selectedSavedOutfitId, setSelectedSavedOutfitId] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recommendation, setRecommendation] = useState(null);
  const [analyzingId, setAnalyzingId] = useState("");
  const [batchAnalyze, setBatchAnalyze] = useState(null);
  const [previewEntry, setPreviewEntry] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [bgRemovingId, setBgRemovingId] = useState("");

  useEffect(() => {
    let active = true;

    async function boot() {
      const db = await openDb();
      dbRef.current = db;
      const loadedItems = await getAll(db, "items");
      const loadedHistory = await getAll(db, "history");
      const loadedSettings = normalizeSettings((await getMeta(db, "settings")) || {});
      const loadedSelection = (await getMeta(db, "selection")) || [];
      const loadedModelAssetId = (await getMeta(db, "modelAssetId")) || "";
      const loadedPromptTemplates = mergeDefaultPromptTemplates((await getMeta(db, "promptTemplates")) || []);
      const loadedSavedOutfits = (await getMeta(db, "savedOutfits")) || [];
      const urls = {};

      for (const item of loadedItems) {
        urls[item.imageAssetId] = await assetToUrl(db, item.imageAssetId);
        if (item.cutoutAssetId) {
          urls[item.cutoutAssetId] = await assetToUrl(db, item.cutoutAssetId);
        }
      }
      for (const entry of loadedHistory) {
        urls[entry.imageAssetId] = await assetToUrl(db, entry.imageAssetId);
      }
      if (loadedModelAssetId) {
        urls[loadedModelAssetId] = await assetToUrl(db, loadedModelAssetId);
      }

      if (!active) return;
      await setMeta(db, "promptTemplates", loadedPromptTemplates);
      setItems(sortByDate(loadedItems));
      setHistory(sortByDate(loadedHistory));
      setSettings(loadedSettings);
      setSelection(loadedSelection);
      setModelAssetId(loadedModelAssetId);
      setPromptTemplates(loadedPromptTemplates);
      setSavedOutfits(loadedSavedOutfits);
      setAssetUrls(urls);
      setReady(true);
    }

    boot().catch((error) => {
      console.error(error);
      alert(`初始化失败：${error.message}`);
    });

    return () => {
      active = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const categoryMatch = category === "all" || item.category === category;
      const haystack = `${item.name} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
      return categoryMatch && haystack.includes(needle);
    });
  }, [items, category, query]);

  const selectedItems = useMemo(
    () => selection.map((id) => items.find((item) => item.id === id)).filter(Boolean),
    [selection, items]
  );

  const filteredHistory = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return history.filter((entry) => {
      if (historyOnlyFavorites && !entry.favorite) return false;
      const haystack = `${entry.itemNames.join(" ")} ${entry.notes || ""} ${entry.debug?.userPrompt || ""}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [history, historyQuery, historyOnlyFavorites]);

  const tryOnChecks = useMemo(
    () => buildTryOnChecks(modelAssetId, selectedItems),
    [modelAssetId, selectedItems]
  );

  const renderedPrompt = useMemo(
    () => renderPromptTemplate(prompt, { occasion, weatherInfo, date: weatherDate }),
    [prompt, occasion, weatherInfo, weatherDate]
  );

  const compareEntries = useMemo(
    () => compareIds.map((id) => history.find((entry) => entry.id === id)).filter(Boolean),
    [compareIds, history]
  );

  function itemImageUrl(item) {
    return assetUrlForItem(item, assetUrls);
  }

  async function handleItemUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length || !dbRef.current) return;

    const nextItems = [];
    const nextUrls = {};
    for (const file of files) {
      const blob = await compressImage(file);
      const assetId = crypto.randomUUID();
      const item = {
        id: crypto.randomUUID(),
        name: cleanName(file.name),
        category: guessCategory(file.name),
        tags: [],
        imageAssetId: assetId,
        createdAt: new Date().toISOString()
      };
      await put(dbRef.current, "assets", { id: assetId, blob, type: blob.type });
      await put(dbRef.current, "items", item);
      nextItems.push(item);
      nextUrls[assetId] = URL.createObjectURL(blob);
    }

    setItems((current) => sortByDate([...nextItems, ...current]));
    setAssetUrls((current) => ({ ...current, ...nextUrls }));
    event.target.value = "";
  }

  async function handleModelUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !dbRef.current) return;

    const blob = await compressImage(file, 1800);
    const assetId = crypto.randomUUID();
    await put(dbRef.current, "assets", { id: assetId, blob, type: blob.type });
    await setMeta(dbRef.current, "modelAssetId", assetId);
    setModelAssetId(assetId);
    setAssetUrls((current) => ({ ...current, [assetId]: URL.createObjectURL(blob) }));
    event.target.value = "";
  }

  async function toggleSelection(itemId) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    if (getItemQuality(item) === "blocked" && !selection.includes(itemId)) {
      alert("这个单品已标记为禁用生成。可以先在编辑里改回正常状态。");
      return;
    }

    const alreadySelected = selection.includes(itemId);
    const nextSelection = alreadySelected
      ? selection.filter((id) => id !== itemId)
      : EXCLUSIVE_CATEGORIES.has(item.category)
        ? [...selection.filter((id) => items.find((entry) => entry.id === id)?.category !== item.category), itemId]
        : [...selection, itemId];
    setSelection(nextSelection);
    setSelectedSavedOutfitId("");
    setRecommendation(null);
    await setMeta(dbRef.current, "selection", nextSelection);
  }

  async function clearSelection() {
    setSelection([]);
    setSelectedSavedOutfitId("");
    setRecommendation(null);
    await setMeta(dbRef.current, "selection", []);
  }

  async function removeSelectedItem(itemId) {
    const nextSelection = selection.filter((id) => id !== itemId);
    setSelection(nextSelection);
    setSelectedSavedOutfitId("");
    setRecommendation(null);
    await setMeta(dbRef.current, "selection", nextSelection);
  }

  async function randomizeOutfit() {
    const picked = [];
    const pickOne = (categoryId) => {
      const candidates = items.filter((item) => item.category === categoryId && getItemQuality(item) !== "blocked" && !picked.includes(item.id));
      if (!candidates.length) return;
      const item = candidates[Math.floor(Math.random() * candidates.length)];
      picked.push(item.id);
    };

    pickOne("top");
    pickOne("bottom");
    pickOne("shoes");
    if (Math.random() > 0.55) pickOne("outerwear");
    if (Math.random() > 0.7) pickOne("accessory");

    if (!picked.length) {
      alert("衣橱里还没有可随机搭配的单品。");
      return;
    }

    setSelection(picked);
    setSelectedSavedOutfitId("");
    setRecommendation(null);
    await setMeta(dbRef.current, "selection", picked);
  }

  async function recommendOutfit() {
    const availableItems = items
      .filter((item) => getItemQuality(item) !== "blocked")
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        tags: item.tags,
        quality: getItemQuality(item)
      }));

    if (!availableItems.length) {
      alert("衣橱里还没有可推荐的单品。");
      return;
    }

    setRecommending(true);
    try {
      const response = await fetch("/api/recommend-outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          occasion,
          weather: weatherInfo,
          items: availableItems
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `推荐失败：${response.status}`);

      const validIds = data.itemIds.filter((id) => items.some((item) => item.id === id));
      if (!validIds.length) throw new Error("推荐结果里没有可用单品。");

      setSelection(validIds);
      setSelectedSavedOutfitId("");
      setRecommendation({
        itemIds: validIds,
        reason: data.reason || "已根据当前场景推荐一套搭配。",
        styleNotes: Array.isArray(data.styleNotes) ? data.styleNotes : []
      });
      await setMeta(dbRef.current, "selection", validIds);
    } catch (error) {
      console.error(error);
      alert(`AI 推荐失败：${error.message}`);
    } finally {
      setRecommending(false);
    }
  }

  async function saveEditedItem(event) {
    event.preventDefault();
    if (!editing || !dbRef.current) return;
    const nextItem = {
      ...editing,
      name: editing.name.trim() || "未命名单品",
      quality: getItemQuality(editing),
      tags: editing.tagText.split(",").map((tag) => tag.trim()).filter(Boolean),
      tagText: undefined
    };
    delete nextItem.tagText;
    const nextSelection = nextItem.quality === "blocked"
      ? selection.filter((id) => id !== nextItem.id)
      : selection;
    await put(dbRef.current, "items", nextItem);
    if (nextSelection.length !== selection.length) {
      await setMeta(dbRef.current, "selection", nextSelection);
      setSelection(nextSelection);
      setSelectedSavedOutfitId("");
      setRecommendation(null);
    }
    setItems((current) => current.map((item) => (item.id === nextItem.id ? nextItem : item)));
    setEditing(null);
  }

  async function analyzeItem(item) {
    if (!dbRef.current || !assetUrls[item.imageAssetId]) return;
    setAnalyzingId(item.id);

    try {
      await analyzeSingleItem(item);
    } catch (error) {
      console.error(error);
      alert(`AI 识别失败：${error.message}`);
    } finally {
      setAnalyzingId("");
    }
  }

  async function analyzeSingleItem(item) {
    const blob = await fetch(assetUrls[item.imageAssetId]).then((response) => response.blob());
    const image = await blobToDataUrl(blob);
    const response = await fetch("/api/analyze-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: settings.provider, image })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `识别失败：${response.status}`);

    const nextItem = {
      ...item,
      name: data.name || item.name,
      category: data.category || item.category,
      tags: Array.isArray(data.tags) ? data.tags : item.tags
    };
    await put(dbRef.current, "items", nextItem);
    setItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));
    setEditing((current) => (current?.id === item.id ? { ...nextItem, tagText: nextItem.tags.join(", ") } : current));
    return nextItem;
  }

  async function analyzeFilteredItems() {
    if (!filteredItems.length || batchAnalyze?.running) return;
    const queue = filteredItems.filter((item) => item.imageAssetId);
    if (!queue.length) return;

    setBatchAnalyze({ running: true, total: queue.length, done: 0, success: 0, failed: 0, currentName: "" });
    let success = 0;
    let failed = 0;

    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      setAnalyzingId(item.id);
      setBatchAnalyze({ running: true, total: queue.length, done: index, success, failed, currentName: item.name });
      try {
        await analyzeSingleItem(item);
        success += 1;
      } catch (error) {
        failed += 1;
        console.error(`Batch analyze failed for ${item.name}:`, error);
      }
      setBatchAnalyze({ running: true, total: queue.length, done: index + 1, success, failed, currentName: item.name });
    }

    setAnalyzingId("");
    setBatchAnalyze({ running: false, total: queue.length, done: queue.length, success, failed, currentName: "" });
  }

  async function deleteItem(item) {
    if (!confirm(`确定从衣橱删除“${item.name}”吗？`)) return;

    await remove(dbRef.current, "items", item.id);
    await remove(dbRef.current, "assets", item.imageAssetId);
    if (item.cutoutAssetId) await remove(dbRef.current, "assets", item.cutoutAssetId);

    const nextSelection = selection.filter((id) => id !== item.id);
    await setMeta(dbRef.current, "selection", nextSelection);

    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setSelection(nextSelection);
    setEditing((current) => (current?.id === item.id ? null : current));
    setAssetUrls((current) => {
      const next = { ...current };
      if (next[item.imageAssetId]) URL.revokeObjectURL(next[item.imageAssetId]);
      if (item.cutoutAssetId && next[item.cutoutAssetId]) URL.revokeObjectURL(next[item.cutoutAssetId]);
      delete next[item.imageAssetId];
      if (item.cutoutAssetId) delete next[item.cutoutAssetId];
      return next;
    });
  }

  async function removeItemBackground(item) {
    if (!dbRef.current || !assetUrls[item.imageAssetId]) return;

    setBgRemovingId(item.id);
    try {
      const sourceBlob = await fetch(assetUrls[item.imageAssetId]).then((response) => response.blob());
      const { removeBackground } = await import("@imgly/background-removal");
      const cutoutBlob = await removeBackground(sourceBlob);
      const assetId = crypto.randomUUID();
      const nextItem = { ...item, cutoutAssetId: assetId };

      await put(dbRef.current, "assets", {
        id: assetId,
        blob: cutoutBlob,
        type: cutoutBlob.type || "image/png"
      });
      await put(dbRef.current, "items", nextItem);
      if (item.cutoutAssetId) await remove(dbRef.current, "assets", item.cutoutAssetId);

      setItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));
      setEditing((current) => (current?.id === item.id ? { ...nextItem, tagText: nextItem.tags.join(", ") } : current));
      setAssetUrls((current) => {
        const next = { ...current };
        if (item.cutoutAssetId && next[item.cutoutAssetId]) {
          URL.revokeObjectURL(next[item.cutoutAssetId]);
          delete next[item.cutoutAssetId];
        }
        next[assetId] = URL.createObjectURL(cutoutBlob);
        return next;
      });
    } catch (error) {
      console.error(error);
      alert(`Background removal failed: ${error.message}`);
    } finally {
      setBgRemovingId("");
    }
  }

  async function rotateItemImage(item, direction) {
    if (!dbRef.current || !assetUrls[item.imageAssetId]) return;

    try {
      const sourceBlob = await fetch(assetUrls[item.imageAssetId]).then((response) => response.blob());
      const rotatedBlob = await rotateImageBlob(sourceBlob, direction);
      const nextItem = { ...item };
      delete nextItem.cutoutAssetId;

      await put(dbRef.current, "assets", {
        id: item.imageAssetId,
        blob: rotatedBlob,
        type: rotatedBlob.type || "image/jpeg"
      });
      if (item.cutoutAssetId) await remove(dbRef.current, "assets", item.cutoutAssetId);
      await put(dbRef.current, "items", nextItem);

      setItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));
      setEditing((current) => (current?.id === item.id ? { ...nextItem, tagText: nextItem.tags.join(", ") } : current));
      setAssetUrls((current) => {
        const next = { ...current };
        if (next[item.imageAssetId]) URL.revokeObjectURL(next[item.imageAssetId]);
        if (item.cutoutAssetId && next[item.cutoutAssetId]) {
          URL.revokeObjectURL(next[item.cutoutAssetId]);
          delete next[item.cutoutAssetId];
        }
        next[item.imageAssetId] = URL.createObjectURL(rotatedBlob);
        return next;
      });
    } catch (error) {
      console.error(error);
      alert(`旋转失败：${error.message}`);
    }
  }

  async function clearItemCutout(item) {
    if (!item.cutoutAssetId || !dbRef.current) return;
    if (!confirm("确定删除这个单品的抠图版本吗？原图会保留。")) return;

    const nextItem = { ...item };
    delete nextItem.cutoutAssetId;
    await remove(dbRef.current, "assets", item.cutoutAssetId);
    await put(dbRef.current, "items", nextItem);

    setItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));
    setEditing((current) => (current?.id === item.id ? { ...nextItem, tagText: nextItem.tags.join(", ") } : current));
    setAssetUrls((current) => {
      const next = { ...current };
      if (next[item.cutoutAssetId]) URL.revokeObjectURL(next[item.cutoutAssetId]);
      delete next[item.cutoutAssetId];
      return next;
    });
  }

  async function saveSettings() {
    await setMeta(dbRef.current, "settings", settings);
    alert("设置已保存。");
  }

  async function savePromptTemplate() {
    const name = window.prompt("给当前 prompt 起个名字：");
    if (!name?.trim()) return;
    const nextTemplate = {
      id: crypto.randomUUID(),
      name: name.trim(),
      prompt,
      createdAt: new Date().toISOString()
    };
    const nextTemplates = [nextTemplate, ...promptTemplates];
    setPromptTemplates(nextTemplates);
    setSelectedPromptTemplateId(nextTemplate.id);
    await setMeta(dbRef.current, "promptTemplates", nextTemplates);
  }

  async function deletePromptTemplate() {
    if (!selectedPromptTemplateId) return;
    const template = promptTemplates.find((entry) => entry.id === selectedPromptTemplateId);
    if (!template || !confirm(`删除 prompt 模板“${template.name}”？`)) return;
    const nextTemplates = promptTemplates.filter((entry) => entry.id !== selectedPromptTemplateId);
    setPromptTemplates(nextTemplates);
    setSelectedPromptTemplateId("");
    await setMeta(dbRef.current, "promptTemplates", nextTemplates);
  }

  function applyPromptTemplate(templateId) {
    const template = promptTemplates.find((entry) => entry.id === templateId);
    if (!template) return;
    setPrompt(template.prompt);
  }

  async function fetchWeatherContext() {
    const city = weatherCity.trim();
    if (!city) {
      alert("请先输入城市。");
      return;
    }

    setWeatherBusy(true);
    try {
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
      const geocodeResponse = await fetch(geocodeUrl);
      const geocodeData = await geocodeResponse.json();
      const place = geocodeData.results?.[0];
      if (!place) throw new Error("没有找到这个城市。");

      const date = weatherDate || todayInputValue();
      const forecastUrl = [
        "https://api.open-meteo.com/v1/forecast",
        `?latitude=${place.latitude}`,
        `&longitude=${place.longitude}`,
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`,
        `&timezone=auto`,
        `&start_date=${date}`,
        `&end_date=${date}`
      ].join("");
      const forecastResponse = await fetch(forecastUrl);
      const forecastData = await forecastResponse.json();
      const daily = forecastData.daily;
      if (!daily?.time?.length) throw new Error("没有拿到这一天的天气。");

      setWeatherInfo({
        city: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
        date: daily.time[0],
        code: daily.weather_code[0],
        condition: weatherCodeLabel(daily.weather_code[0]),
        tempMin: Math.round(daily.temperature_2m_min[0]),
        tempMax: Math.round(daily.temperature_2m_max[0]),
        precipitation: daily.precipitation_probability_max?.[0] ?? null
      });
    } catch (error) {
      console.error(error);
      alert(`获取天气失败：${error.message}`);
    } finally {
      setWeatherBusy(false);
    }
  }

  function clearWeatherContext() {
    setWeatherInfo(null);
  }

  async function saveCurrentOutfit() {
    if (!selectedItems.length) {
      alert("请先至少选择一件单品，再保存搭配。");
      return;
    }

    const fallbackName = selectedItems.map((item) => item.name).join(" + ");
    const name = window.prompt("给这套搭配起个名字：", fallbackName.slice(0, 80));
    if (!name?.trim()) return;

    const nextOutfit = {
      id: crypto.randomUUID(),
      name: name.trim(),
      itemIds: selectedItems.map((item) => item.id),
      itemNames: selectedItems.map((item) => item.name),
      createdAt: new Date().toISOString()
    };
    const nextOutfits = [nextOutfit, ...savedOutfits];
    setSavedOutfits(nextOutfits);
    setSelectedSavedOutfitId(nextOutfit.id);
    await setMeta(dbRef.current, "savedOutfits", nextOutfits);
  }

  async function applySavedOutfit(outfitId) {
    const outfit = savedOutfits.find((entry) => entry.id === outfitId);
    if (!outfit) return;

    const reusableIds = outfit.itemIds.filter((id) => items.some((item) => item.id === id));
    if (!reusableIds.length) {
      alert("这套搭配里的单品已经不在衣橱里了。");
      return;
    }

    setSelection(reusableIds);
    setSelectedSavedOutfitId("");
    setRecommendation(null);
    await setMeta(dbRef.current, "selection", reusableIds);
  }

  async function deleteSavedOutfit() {
    if (!selectedSavedOutfitId) return;
    const outfit = savedOutfits.find((entry) => entry.id === selectedSavedOutfitId);
    if (!outfit || !confirm(`删除搭配“${outfit.name}”？`)) return;

    const nextOutfits = savedOutfits.filter((entry) => entry.id !== selectedSavedOutfitId);
    setSavedOutfits(nextOutfits);
    setSelectedSavedOutfitId("");
    await setMeta(dbRef.current, "savedOutfits", nextOutfits);
  }

  async function generateTryOn() {
    if (!dbRef.current) return;
    if (!modelAssetId) {
      alert("请先上传本人参考照。");
      return;
    }
    if (!selectedItems.length) {
      alert("请至少选择一件单品。");
      return;
    }
    if (tryOnChecks.blockedItems.length) {
      alert(`有禁用生成的单品：${tryOnChecks.blockedItems.map((item) => item.name).join("、")}。请先移除或改回正常状态。`);
      return;
    }
    setBusy(true);
    try {
      const requestDebug = buildRequestDebug(settings, occasion, prompt, renderedPrompt, modelAssetId, selectedItems, weatherInfo);
      const result = settings.endpoint
        ? await callBackend(dbRef.current, settings, occasion, renderedPrompt, modelAssetId, selectedItems)
        : await createLocalMockup(assetUrls[modelAssetId], selectedItems, assetUrls, occasion, settings);

      const resultBlob = result.imageBlob || (await dataUrlToBlob(result.imageUrl));
      const assetId = crypto.randomUUID();
      const entry = {
        id: crypto.randomUUID(),
        imageAssetId: assetId,
        itemIds: selectedItems.map((item) => item.id),
        itemNames: selectedItems.map((item) => item.name),
        favorite: false,
        notes: result.notes || (settings.endpoint ? "AI 生成结果" : "本地预览稿"),
        debug: {
          ...requestDebug,
          response: result.debug || null
        },
        createdAt: new Date().toISOString()
      };

      await put(dbRef.current, "assets", { id: assetId, blob: resultBlob, type: resultBlob.type });
      await put(dbRef.current, "history", entry);

      setAssetUrls((current) => ({ ...current, [assetId]: URL.createObjectURL(resultBlob) }));
      setHistory((current) => sortByDate([entry, ...current]));
      setView("history");
    } catch (error) {
      console.error(error);
      alert(`生成失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (!confirm("确定清空生成历史吗？")) return;
    for (const entry of history) {
      await remove(dbRef.current, "assets", entry.imageAssetId);
      await remove(dbRef.current, "history", entry.id);
    }
    setHistory([]);
  }

  async function deleteHistoryEntry(entry) {
    if (!confirm("确定删除这张生成结果吗？")) return;

    await remove(dbRef.current, "assets", entry.imageAssetId);
    await remove(dbRef.current, "history", entry.id);
    setHistory((current) => current.filter((item) => item.id !== entry.id));
    setCompareIds((current) => current.filter((id) => id !== entry.id));
    setPreviewEntry((current) => (current?.id === entry.id ? null : current));
    setAssetUrls((current) => {
      const next = { ...current };
      if (next[entry.imageAssetId]) URL.revokeObjectURL(next[entry.imageAssetId]);
      delete next[entry.imageAssetId];
      return next;
    });
  }

  async function toggleHistoryFavorite(entry) {
    const nextEntry = { ...entry, favorite: !entry.favorite };
    await put(dbRef.current, "history", nextEntry);
    setHistory((current) => current.map((item) => (item.id === entry.id ? nextEntry : item)));
    setPreviewEntry((current) => (current?.id === entry.id ? nextEntry : current));
  }

  function toggleCompareEntry(entry) {
    setCompareIds((current) => {
      if (current.includes(entry.id)) return current.filter((id) => id !== entry.id);
      return [...current.slice(-1), entry.id];
    });
  }

  function clearCompareSelection() {
    setCompareIds([]);
    setCompareOpen(false);
  }

  async function reuseHistoryOutfit(entry) {
    const reusableIds = Array.isArray(entry.itemIds) && entry.itemIds.length
      ? entry.itemIds.filter((id) => items.some((item) => item.id === id))
      : entry.itemNames
        .map((name) => items.find((item) => item.name === name)?.id)
        .filter(Boolean);

    if (!reusableIds.length) {
      alert("No matching closet items found for this history entry.");
      return;
    }

    setSelection(reusableIds);
    await setMeta(dbRef.current, "selection", reusableIds);
    setRecommendation(null);
    setPreviewEntry(null);
    setView("tryon");
  }

  async function resetAll() {
    if (!confirm("确定清空衣橱、本人照和历史记录吗？")) return;
    await clearStore(dbRef.current, "items");
    await clearStore(dbRef.current, "history");
    await clearStore(dbRef.current, "assets");
    await clearStore(dbRef.current, "meta");
    setItems([]);
    setHistory([]);
    setSelection([]);
    setModelAssetId("");
    setSavedOutfits([]);
    setSelectedSavedOutfitId("");
    setAssetUrls({});
  }

  async function downloadHistoryImage(entry) {
    const imageUrl = assetUrls[entry.imageAssetId];
    if (!imageUrl) return;

    const blob = await fetch(imageUrl).then((response) => response.blob());
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `try-on-${entry.createdAt.slice(0, 10)}-${entry.id.slice(0, 8)}.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  async function copyDebugInfo(entry) {
    const text = JSON.stringify(entry.debug || {}, null, 2);
    await navigator.clipboard.writeText(text);
    alert("调试信息已复制。");
  }

  async function exportBackup() {
    const db = dbRef.current;
    const assets = await getAll(db, "assets");
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      history,
      meta: {
        settings,
        selection,
        modelAssetId,
        promptTemplates,
        savedOutfits
      },
      assets: await Promise.all(assets.map(async (asset) => ({
        id: asset.id,
        type: asset.type || asset.blob?.type || "image/jpeg",
        dataUrl: await blobToDataUrl(asset.blob)
      })))
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `cloth-try-on-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !dbRef.current) return;
    if (!confirm("导入备份会替换当前本地衣橱、历史记录和设置。确定继续吗？")) return;

    const backup = JSON.parse(await file.text());
    if (!Array.isArray(backup.items) || !Array.isArray(backup.history) || !Array.isArray(backup.assets)) {
      alert("备份文件格式不正确。");
      return;
    }

    const db = dbRef.current;
    await clearStore(db, "items");
    await clearStore(db, "history");
    await clearStore(db, "assets");
    await clearStore(db, "meta");

    const urls = {};
    for (const asset of backup.assets) {
      const blob = await dataUrlToBlob(asset.dataUrl);
      await put(db, "assets", { id: asset.id, blob, type: asset.type || blob.type });
      urls[asset.id] = URL.createObjectURL(blob);
    }
    for (const item of backup.items) await put(db, "items", item);
    for (const entry of backup.history) await put(db, "history", entry);

    const nextSettings = { ...DEFAULT_SETTINGS, ...(backup.meta?.settings || {}) };
    const nextSelection = backup.meta?.selection || [];
    const nextModelAssetId = backup.meta?.modelAssetId || "";
    const nextPromptTemplates = mergeDefaultPromptTemplates(backup.meta?.promptTemplates || []);
    const nextSavedOutfits = backup.meta?.savedOutfits || [];

    await setMeta(db, "settings", nextSettings);
    await setMeta(db, "selection", nextSelection);
    await setMeta(db, "modelAssetId", nextModelAssetId);
    await setMeta(db, "promptTemplates", nextPromptTemplates);
    await setMeta(db, "savedOutfits", nextSavedOutfits);

    setItems(sortByDate(backup.items));
    setHistory(sortByDate(backup.history));
    setSettings(nextSettings);
    setSelection(nextSelection);
    setModelAssetId(nextModelAssetId);
    setPromptTemplates(nextPromptTemplates);
    setSavedOutfits(nextSavedOutfits);
    setSelectedSavedOutfitId("");
    setAssetUrls((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return urls;
    });
    setPreviewEntry(null);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CT</div>
          <div>
            <h1>Try-On Studio</h1>
            <p>Next.js 自用衣橱</p>
          </div>
        </div>

        <nav className="tabs" aria-label="主导航">
          {[
            ["closet", "衣橱"],
            ["tryon", "试穿"],
            ["history", "历史"],
            ["settings", "设置"]
          ].map(([id, label]) => (
            <button className={`tab ${view === id ? "active" : ""}`} key={id} onClick={() => setView(id)} type="button">
              <span>{label}</span>
              {id === "closet" && <span>{items.length}</span>}
              {id === "tryon" && <span>{selection.length}</span>}
              {id === "history" && <span>{history.length}</span>}
            </button>
          ))}
        </nav>

        <div className="status">
          <div className="status-row">
            <span>存储</span>
            <strong>IndexedDB</strong>
          </div>
          <div className="status-row">
            <span>生成</span>
            <strong>{settings.endpoint ? settings.provider : "本地预览"}</strong>
          </div>
          <div className="status-row">
            <span>状态</span>
            <strong>{ready ? "就绪" : "加载中"}</strong>
          </div>
        </div>
      </aside>

      <main className="main">
        {view === "closet" && (
          <>
            <PageHead title="数字衣橱" desc="上传你的衣服、鞋和配饰。图片会压缩后保存到浏览器 IndexedDB。">
              <button className="button" disabled={!filteredItems.length || batchAnalyze?.running} onClick={analyzeFilteredItems} type="button">
                {batchAnalyze?.running ? "识别中" : "批量识别"}
              </button>
              <label className="file-button primary">
                <input accept="image/*" multiple onChange={handleItemUpload} type="file" />
                上传单品
              </label>
            </PageHead>

            <div className="toolbar">
              <select className="select" onChange={(event) => setCategory(event.target.value)} value={category}>
                <option value="all">全部类别</option>
                {Object.entries(CATEGORIES).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <input className="input" onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、颜色、风格" value={query} />
            </div>

            {batchAnalyze && (
              <section className="batch-progress">
                <div className="batch-progress-head">
                  <strong>{batchAnalyze.running ? "正在批量识别" : "批量识别完成"}</strong>
                  <span>{batchAnalyze.done}/{batchAnalyze.total}</span>
                </div>
                <div className="progress-bar" aria-label="批量识别进度">
                  <span style={{ width: `${batchAnalyze.total ? Math.round((batchAnalyze.done / batchAnalyze.total) * 100) : 0}%` }} />
                </div>
                <p>
                  成功 {batchAnalyze.success}，失败 {batchAnalyze.failed}
                  {batchAnalyze.running && batchAnalyze.currentName ? `，当前：${batchAnalyze.currentName}` : ""}
                </p>
              </section>
            )}

            {filteredItems.length ? (
              <div className="grid">
                {filteredItems.map((item) => (
                  <article className="card" key={item.id}>
                    <img className="card-image" src={itemImageUrl(item)} alt={item.name} />
                    <div className="card-body">
                      <p className="card-title">{item.name}</p>
                      <div className="card-meta-row">
                        <span className="card-meta">{[CATEGORIES[item.category], ...item.tags].filter(Boolean).join(" / ") || "未标注"}</span>
                        <div className="badge-stack">
                          {item.cutoutAssetId && <span className="badge">已抠图</span>}
                          {getItemQuality(item) !== "normal" && (
                            <span className={`badge ${ITEM_QUALITY[getItemQuality(item)].tone}`}>{ITEM_QUALITY[getItemQuality(item)].label}</span>
                          )}
                        </div>
                      </div>
                      <div className="card-actions">
                        <button className={`small-button ${selection.includes(item.id) ? "selected" : ""}`} onClick={() => toggleSelection(item.id)} type="button">
                          {selection.includes(item.id) ? "已选择" : getSelectionButtonLabel(item, selection, items)}
                        </button>
                        <button className="small-button" onClick={() => setEditing({ ...item, tagText: item.tags.join(", ") })} type="button">
                          编辑
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="先放几件衣服进来" desc="建议平铺拍摄，光线均匀，背景尽量干净。" />
            )}
          </>
        )}

        {view === "tryon" && (
          <>
            <PageHead title="生成试穿图" desc="先用本地预览跑通流程；填入 Lambda endpoint 后会请求真实 AI 后端。">
              <button className="button" disabled={recommending || !items.length} onClick={recommendOutfit} type="button">
                {recommending ? "推荐中" : "AI推荐搭配"}
              </button>
              <button className="button" onClick={randomizeOutfit} type="button">随机搭配</button>
              <button className="button" onClick={clearSelection} type="button">清空选择</button>
              <button className="button primary" disabled={busy} onClick={() => generateTryOn()} type="button">
                {busy ? "生成中" : "生成"}
              </button>
            </PageHead>

            <div className="tryon-grid">
              <section className="panel">
                <div className="panel-head">
                  <h3>本人参考照</h3>
                  <label className="file-button">
                    <input accept="image/*" onChange={handleModelUpload} type="file" />
                    上传
                  </label>
                </div>
                <div className="model-frame">
                  {modelAssetId ? <img src={assetUrls[modelAssetId]} alt="本人参考照" /> : <span>上传一张正面全身照</span>}
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h3>本次搭配</h3>
                  <span className="muted">{selectedItems.length} 件</span>
                </div>

                <div className="selected-list">
                  {selectedItems.length ? selectedItems.map((item) => (
                    <div className="selected-row" key={item.id}>
                      <img src={itemImageUrl(item)} alt={item.name} />
                      <div>
                        <strong>{item.name}</strong>
                        <div className="card-meta">{CATEGORIES[item.category]}</div>
                      </div>
                      <button className="small-button danger-text" onClick={() => removeSelectedItem(item.id)} type="button">移除</button>
                    </div>
                  )) : <Empty title="还没选择单品" desc="回到衣橱页挑几件衣服。" />}
                </div>

                <div className="outfit-tools">
                  <select
                    className="select"
                    onChange={(event) => {
                      setSelectedSavedOutfitId(event.target.value);
                      applySavedOutfit(event.target.value);
                    }}
                    value={selectedSavedOutfitId}
                  >
                    <option value="">选择搭配方案</option>
                    {savedOutfits.map((outfit) => (
                      <option key={outfit.id} value={outfit.id}>{outfit.name}</option>
                    ))}
                  </select>
                  <button className="button" onClick={saveCurrentOutfit} type="button">保存搭配</button>
                  <button className="button danger" disabled={!selectedSavedOutfitId} onClick={deleteSavedOutfit} type="button">删除方案</button>
                </div>

                {recommendation && (
                  <div className="recommendation-note">
                    <strong>AI 推荐</strong>
                    <p>{recommendation.reason}</p>
                    {recommendation.styleNotes.length ? (
                      <p>{recommendation.styleNotes.join(" / ")}</p>
                    ) : null}
                  </div>
                )}

                <div className={`preflight-panel ${tryOnChecks.hasBlockingIssue ? "warning" : "ready"}`}>
                  <div className="preflight-head">
                    <strong>生成前检查</strong>
                    <span>{tryOnChecks.hasBlockingIssue ? "需要处理" : "可以生成"}</span>
                  </div>
                  <div className="preflight-grid">
                    {tryOnChecks.items.map((check) => (
                      <div className={`preflight-item ${check.status}`} key={check.id}>
                        <span>{check.label}</span>
                        <strong>{check.value}</strong>
                      </div>
                    ))}
                  </div>
                  {tryOnChecks.messages.length ? (
                    <ul className="preflight-messages">
                      {tryOnChecks.messages.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <label className="field-label" htmlFor="occasion">场景</label>
                <div className="occasion-presets" aria-label="场景快捷选项">
                  {OCCASION_PRESETS.map((preset) => (
                    <button
                      className={`small-button ${occasion === preset ? "selected" : ""}`}
                      key={preset}
                      onClick={() => setOccasion(preset)}
                      type="button"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input className="input" id="occasion" onChange={(event) => setOccasion(event.target.value)} value={occasion} />

                <div className="weather-panel">
                  <div className="weather-grid">
                    <label>
                      <span>城市</span>
                      <input className="input" onChange={(event) => setWeatherCity(event.target.value)} placeholder="Sydney / 上海 / Tokyo" value={weatherCity} />
                    </label>
                    <label>
                      <span>日期</span>
                      <input className="input" onChange={(event) => setWeatherDate(event.target.value)} type="date" value={weatherDate} />
                    </label>
                    <button className="button" disabled={weatherBusy} onClick={fetchWeatherContext} type="button">
                      {weatherBusy ? "获取中" : "获取天气"}
                    </button>
                    <button className="button" disabled={!weatherInfo} onClick={clearWeatherContext} type="button">清除天气</button>
                  </div>
                  {weatherInfo ? (
                    <p className="weather-summary">
                      {weatherInfo.city} · {weatherInfo.date} · {weatherInfo.condition} · {weatherInfo.tempMin}-{weatherInfo.tempMax}°C
                      {weatherInfo.precipitation !== null ? ` · 降水概率 ${weatherInfo.precipitation}%` : ""}
                    </p>
                  ) : (
                    <p className="weather-summary muted">天气主要用于 AI 推荐。只有 prompt 模板里显式写变量时才会进入最终 Prompt：{"{{occasion}}"}、{"{{weather}}"}、{"{{temperature}}"}、{"{{city}}"}、{"{{date}}"}、{"{{season}}"}</p>
                  )}
                </div>

                <label className="field-label" htmlFor="prompt">生成要求</label>
                <textarea className="textarea" id="prompt" onChange={(event) => setPrompt(event.target.value)} value={prompt} />
                <div className="prompt-tools">
                  <select
                    className="select"
                    onChange={(event) => {
                      setSelectedPromptTemplateId(event.target.value);
                      applyPromptTemplate(event.target.value);
                    }}
                    value={selectedPromptTemplateId}
                  >
                    <option value="">选择 prompt 模板</option>
                    {promptTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                  <button className="button" onClick={savePromptTemplate} type="button">保存为模板</button>
                  <button className="button danger" disabled={!selectedPromptTemplateId} onClick={deletePromptTemplate} type="button">删除模板</button>
                </div>
                <details className="final-prompt-preview">
                  <summary>最终 Prompt 预览</summary>
                  <p>{renderedPrompt}</p>
                </details>
              </section>
            </div>
          </>
        )}

        {view === "history" && (
          <>
            <PageHead title="生成历史" desc="每次生成的结果会保存到 IndexedDB。">
              <button className="button" disabled={compareEntries.length !== 2} onClick={() => setCompareOpen(true)} type="button">
                对比两张
              </button>
              <button className="button" disabled={!compareIds.length} onClick={clearCompareSelection} type="button">清空对比</button>
              <button className="button danger" onClick={clearHistory} type="button">清空历史</button>
            </PageHead>
            <div className="toolbar">
              <input className="input" onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索单品、备注、prompt" value={historyQuery} />
              <label className="check-row compact">
                <input checked={historyOnlyFavorites} onChange={(event) => setHistoryOnlyFavorites(event.target.checked)} type="checkbox" />
                <span>只看收藏</span>
              </label>
            </div>
            {compareIds.length ? (
              <div className="compare-strip">
                已选择 {compareEntries.length}/2 张用于对比
                {compareEntries.length ? `：${compareEntries.map((entry) => new Date(entry.createdAt).toLocaleString()).join(" / ")}` : ""}
              </div>
            ) : null}
            {filteredHistory.length ? (
              <div className="grid">
                {filteredHistory.map((entry) => (
                  <article
                    className={`history-card clickable ${compareIds.includes(entry.id) ? "compare-selected" : ""}`}
                    key={entry.id}
                    onClick={() => setPreviewEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setPreviewEntry(entry);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="history-image-wrap">
                      <img className="history-image" src={assetUrls[entry.imageAssetId]} alt="生成结果" />
                      <button
                        className={`compare-toggle ${compareIds.includes(entry.id) ? "active" : ""}`}
                        onClick={(event) => { event.stopPropagation(); toggleCompareEntry(entry); }}
                        type="button"
                      >
                        {compareIds.includes(entry.id) ? "已选对比" : "加入对比"}
                      </button>
                    </div>
                    <div className="history-body">
                      <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                      <p>{entry.itemNames.join(" / ")}</p>
                      <p>{entry.notes}</p>
                      <span className="open-hint">查看大图</span>
                      <div className="history-card-actions">
                        <button className="small-button" onClick={(event) => { event.stopPropagation(); toggleHistoryFavorite(entry); }} type="button">
                          {entry.favorite ? "已收藏" : "收藏"}
                        </button>
                        <button className="small-button" onClick={(event) => { event.stopPropagation(); reuseHistoryOutfit(entry); }} type="button">
                          复用
                        </button>
                        <button className="small-button" onClick={(event) => { event.stopPropagation(); downloadHistoryImage(entry); }} type="button">
                          下载
                        </button>
                        <button className="small-button danger-text" onClick={(event) => { event.stopPropagation(); deleteHistoryEntry(entry); }} type="button">
                          删除
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <Empty title="还没有生成记录" desc="去试穿页生成第一张效果图。" />}
          </>
        )}

        {view === "settings" && (
          <>
            <PageHead title="后端设置" desc="这里先保存后端地址和 provider，下一步可接 AWS Lambda + MongoDB + S3。">
              <input accept="application/json" hidden onChange={importBackup} ref={backupFileRef} type="file" />
              <button className="button" onClick={exportBackup} type="button">导出备份</button>
              <button className="button" onClick={() => backupFileRef.current?.click()} type="button">导入备份</button>
              <button className="button danger" onClick={resetAll} type="button">重置本地数据</button>
              <button className="button primary" onClick={saveSettings} type="button">保存设置</button>
            </PageHead>

            <section className="panel settings">
              <div className="notice">API key 不要放在浏览器里。这里填 API Gateway 地址，让 Lambda 在服务端读取 Gemini/OpenAI key。</div>

              <label className="field-label" htmlFor="endpoint">Lambda/API Gateway endpoint</label>
              <input
                className="input"
                id="endpoint"
                onChange={(event) => setSettings((current) => ({ ...current, endpoint: event.target.value.trim() }))}
                placeholder="https://example.execute-api.ap-southeast-2.amazonaws.com/generate"
                value={settings.endpoint}
              />

              <label className="field-label" htmlFor="provider">AI provider</label>
              <select
                className="select"
                id="provider"
                onChange={(event) => setSettings((current) => ({ ...current, provider: event.target.value }))}
                value={settings.provider}
              >
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
              </select>

              <label className="field-label" htmlFor="mongoDb">MongoDB database name</label>
              <input
                className="input"
                id="mongoDb"
                onChange={(event) => setSettings((current) => ({ ...current, mongoDb: event.target.value.trim() }))}
                placeholder="cloth_try_on"
                value={settings.mongoDb}
              />

            </section>
          </>
        )}
      </main>

      {editing && (
        <div className="dialog-backdrop">
          <form className="dialog" onSubmit={saveEditedItem}>
            <h3>编辑单品</h3>
            <div className="edit-preview">
              <img src={itemImageUrl(editing)} alt={editing.name} />
              {editing.cutoutAssetId && <span className="badge">已抠图</span>}
            </div>
            <p className="edit-note">
              当前预览：{editing.cutoutAssetId ? "抠图版本。生成时是否使用它取决于设置里的开关。" : "原图。可以先做背景消除，再用于生成。"}
            </p>

            <label className="field-label" htmlFor="editName">名称</label>
            <input className="input" id="editName" onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} value={editing.name} />

            <label className="field-label" htmlFor="editCategory">类别</label>
            <select className="select" id="editCategory" onChange={(event) => setEditing((current) => ({ ...current, category: event.target.value }))} value={editing.category}>
              {Object.entries(CATEGORIES).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>

            <label className="field-label" htmlFor="editQuality">生成状态</label>
            <select
              className="select"
              id="editQuality"
              onChange={(event) => setEditing((current) => ({ ...current, quality: event.target.value }))}
              value={getItemQuality(editing)}
            >
              {Object.entries(ITEM_QUALITY).map(([id, config]) => (
                <option key={id} value={id}>{config.label}</option>
              ))}
            </select>

            <label className="field-label" htmlFor="editTags">标签</label>
            <input className="input" id="editTags" onChange={(event) => setEditing((current) => ({ ...current, tagText: event.target.value }))} placeholder="黑色, 棉, 休闲" value={editing.tagText} />

            <div className="tool-group">
              <div className="tool-group-title">图片工具</div>
              <div className="tool-grid">
                <button className="button" disabled={analyzingId === editing.id} onClick={() => analyzeItem(editing)} type="button">
                  {analyzingId === editing.id ? "识别中" : "AI识别"}
                </button>
                <button className="button" disabled={bgRemovingId === editing.id} onClick={() => removeItemBackground(editing)} type="button">
                  {bgRemovingId === editing.id ? "处理中" : "背景消除"}
                </button>
                <button className="button" disabled={!editing.cutoutAssetId} onClick={() => clearItemCutout(editing)} type="button">
                  删除抠图
                </button>
                <button className="button" onClick={() => rotateItemImage(editing, "left")} type="button">左转90度</button>
                <button className="button" onClick={() => rotateItemImage(editing, "right")} type="button">右转90度</button>
              </div>
            </div>

            <div className="dialog-actions">
              <button className="button danger" onClick={() => deleteItem(editing)} type="button">删除</button>
              <span className="dialog-spacer" />
              <button className="button" onClick={() => setEditing(null)} type="button">取消</button>
              <button className="button primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      )}

      {previewEntry && (
        <div className="image-viewer-backdrop" onClick={() => setPreviewEntry(null)}>
          <section className="image-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="image-viewer-head">
              <div>
                <h3>试穿结果</h3>
                <p>{new Date(previewEntry.createdAt).toLocaleString()}</p>
              </div>
              <button className="button" onClick={() => setPreviewEntry(null)} type="button">关闭</button>
            </div>

            <img className="image-viewer-img" src={assetUrls[previewEntry.imageAssetId]} alt="试穿结果大图" />

            <div className="image-viewer-meta">
              <div>
                <strong>单品</strong>
                <p>{previewEntry.itemNames.join(" / ")}</p>
              </div>
              <div>
                <strong>备注</strong>
                <p>{previewEntry.notes}</p>
              </div>
            </div>

            <details className="debug-panel" open>
              <summary>调试信息 / 完整 Prompt</summary>
              {previewEntry.debug ? (
                <>
                  <div className="debug-actions">
                    <button className="button" onClick={() => copyDebugInfo(previewEntry)} type="button">复制调试信息</button>
                  </div>
                  <div className="debug-prompt">
                    <strong>最终 Prompt</strong>
                    <p>{previewEntry.debug.finalPrompt || previewEntry.debug.response?.finalPrompt || previewEntry.debug.userPrompt || "未记录"}</p>
                  </div>
                  <pre>{JSON.stringify(previewEntry.debug, null, 2)}</pre>
                </>
              ) : (
                <p className="muted">这条历史记录没有保存调试信息。请重新生成一次，新记录会保存完整 prompt。</p>
              )}
            </details>

            <div className="image-viewer-actions">
              <button className="button" onClick={() => toggleHistoryFavorite(previewEntry)} type="button">
                {previewEntry.favorite ? "已收藏" : "收藏"}
              </button>
              <button className="button" onClick={() => reuseHistoryOutfit(previewEntry)} type="button">复用搭配</button>
              <button className="button primary" onClick={() => downloadHistoryImage(previewEntry)} type="button">下载</button>
              <button className="button" onClick={() => window.open(assetUrls[previewEntry.imageAssetId], "_blank", "noopener,noreferrer")} type="button">
                新标签打开
              </button>
              <button className="button danger" onClick={() => deleteHistoryEntry(previewEntry)} type="button">删除</button>
            </div>
          </section>
        </div>
      )}

      {compareOpen && compareEntries.length === 2 && (
        <div className="image-viewer-backdrop" onClick={() => setCompareOpen(false)}>
          <section className="compare-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="image-viewer-head">
              <div>
                <h3>历史结果对比</h3>
                <p>并排查看图片、单品和最终 Prompt。</p>
              </div>
              <button className="button" onClick={() => setCompareOpen(false)} type="button">关闭</button>
            </div>

            <div className="compare-grid">
              {compareEntries.map((entry) => (
                <article className="compare-pane" key={entry.id}>
                  <img src={assetUrls[entry.imageAssetId]} alt="对比图" />
                  <div className="compare-meta">
                    <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                    <p>{entry.itemNames.join(" / ")}</p>
                    <p>{entry.notes}</p>
                  </div>
                  <div className="compare-prompt">
                    <strong>最终 Prompt</strong>
                    <p>{entry.debug?.finalPrompt || entry.debug?.response?.finalPrompt || entry.debug?.userPrompt || "未记录"}</p>
                  </div>
                  <div className="compare-actions">
                    <button className="button" onClick={() => reuseHistoryOutfit(entry)} type="button">复用这套</button>
                    <button className="button primary" onClick={() => downloadHistoryImage(entry)} type="button">下载</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PageHead({ title, desc, children }) {
  return (
    <div className="page-head">
      <div className="page-title">
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

function Empty({ title, desc }) {
  return (
    <div className="empty">
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </div>
  );
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets", { keyPath: "id" });
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txStore(db, storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = txStore(db, storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getOne(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = txStore(db, storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const request = txStore(db, storeName, "readwrite").put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function remove(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = txStore(db, storeName, "readwrite").delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = txStore(db, storeName, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getMeta(db, key) {
  const entry = await getOne(db, "meta", key);
  return entry?.value;
}

function setMeta(db, key, value) {
  return put(db, "meta", { key, value });
}

async function assetToUrl(db, assetId) {
  const asset = await getOne(db, "assets", assetId);
  return asset?.blob ? URL.createObjectURL(asset.blob) : "";
}

async function callBackend(db, settings, occasion, prompt, modelAssetId, selectedItems) {
  const modelAsset = await getOne(db, "assets", modelAssetId);
  const items = [];
  for (const item of selectedItems) {
    const asset = await getOne(db, "assets", item.imageAssetId);
    items.push({ ...item, generationMode: "image", image: await blobToDataUrl(asset.blob) });
  }

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: settings.provider,
      occasion,
      prompt,
      modelImage: await blobToDataUrl(modelAsset.blob),
      items
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `后端返回 ${response.status}`);
  if (!data.imageUrl) throw new Error("后端响应缺少 imageUrl");

  if (data.imageUrl.startsWith("data:")) {
    return { imageBlob: await dataUrlToBlob(data.imageUrl), notes: data.notes, debug: data.debug || null };
  }

  const imageResponse = await fetch(data.imageUrl);
  if (!imageResponse.ok) throw new Error("无法下载后端生成图");
  return { imageBlob: await imageResponse.blob(), notes: data.notes, debug: data.debug || null };
}

async function createLocalMockup(modelUrl, selectedItems, assetUrls, occasion, settings) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  const model = await loadImage(modelUrl);

  drawCover(ctx, model, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(247, 249, 248, 0.9)";
  roundRect(ctx, 36, 36, 1008, 180, 22);
  ctx.fill();
  ctx.fillStyle = "#182022";
  ctx.font = "700 44px Arial";
  ctx.fillText("Try-On Preview", 68, 100);
  ctx.font = "28px Arial";
  ctx.fillText(occasion || "未设置场景", 68, 146);
  ctx.fillStyle = "#657174";
  ctx.font = "22px Arial";
  ctx.fillText("配置 Lambda 后将替换为真实 AI 试穿图", 68, 186);

  const thumb = 176;
  const gap = 18;
  const totalWidth = selectedItems.length * thumb + Math.max(0, selectedItems.length - 1) * gap;
  let x = (canvas.width - totalWidth) / 2;
  const y = canvas.height - thumb - 46;

  for (const item of selectedItems) {
    const image = await loadImage(itemImageUrl(item));
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x - 7, y - 7, thumb + 14, thumb + 14, 18);
    ctx.fill();
    drawCover(ctx, image, x, y, thumb, thumb);
    x += thumb + gap;
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return { imageBlob: blob, notes: "本地预览稿。配置 Lambda 后会调用真实 AI。" };
}

async function compressImage(file, maxEdge = 1500) {
  const src = URL.createObjectURL(file);
  try {
    const image = await loadImage(src);
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function rotateImageBlob(blob, direction) {
  const src = URL.createObjectURL(blob);
  try {
    const image = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = image.height;
    canvas.height = image.width;
    const ctx = canvas.getContext("2d");

    if (direction === "left") {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    } else {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    }

    ctx.drawImage(image, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(src);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function drawCover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (image.width - sw) / 2;
  const sy = (image.height - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function guessCategory(name) {
  const lower = name.toLowerCase();
  if (/shoe|sneaker|boot|loafer|鞋/.test(lower)) return "shoes";
  if (/pant|jean|trouser|short|skirt|裤|裙/.test(lower)) return "bottom";
  if (/coat|jacket|blazer|hoodie|外套/.test(lower)) return "outerwear";
  if (/bag|cap|hat|belt|scarf|包|帽|围巾/.test(lower)) return "accessory";
  return "top";
}

function cleanName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "未命名单品";
}

function assetUrlForItem(item, assetUrls) {
  return assetUrls[item.cutoutAssetId] || assetUrls[item.imageAssetId] || "";
}

function getItemQuality(item) {
  return ITEM_QUALITY[item?.quality] ? item.quality : "normal";
}

function getSelectionButtonLabel(item, selection, items) {
  if (getItemQuality(item) === "blocked") return "禁用";
  if (!EXCLUSIVE_CATEGORIES.has(item.category)) return "选择";
  return selection.some((id) => items.find((entry) => entry.id === id)?.category === item.category) ? "替换" : "选择";
}

function buildTryOnChecks(modelAssetId, selectedItems) {
  const selectedCategories = new Set(selectedItems.map((item) => item.category));
  const missingCore = [
    ["top", "上衣"],
    ["bottom", "下装"],
    ["shoes", "鞋"]
  ].filter(([categoryId]) => !selectedCategories.has(categoryId));
  const retakeItems = selectedItems.filter((item) => getItemQuality(item) === "retake");
  const blockedItems = selectedItems.filter((item) => getItemQuality(item) === "blocked");
  const messages = [];

  if (!modelAssetId) messages.push("还没有上传本人参考照。");
  if (!selectedItems.length) messages.push("还没有选择任何单品。");
  if (missingCore.length) messages.push(`缺少核心品类：${missingCore.map(([, label]) => label).join("、")}。`);
  if (retakeItems.length) messages.push(`这些单品标记为待重拍：${retakeItems.map((item) => item.name).join("、")}。`);
  if (blockedItems.length) messages.push(`这些单品禁用生成：${blockedItems.map((item) => item.name).join("、")}。`);

  return {
    blockedItems,
    hasBlockingIssue: !modelAssetId || !selectedItems.length || Boolean(blockedItems.length),
    messages,
    items: [
      { id: "model", label: "本人照", value: modelAssetId ? "已上传" : "缺少", status: modelAssetId ? "ok" : "bad" },
      { id: "selection", label: "单品", value: selectedItems.length ? `${selectedItems.length} 件` : "未选择", status: selectedItems.length ? "ok" : "bad" },
      { id: "core", label: "核心品类", value: missingCore.length ? `缺 ${missingCore.length} 类` : "完整", status: missingCore.length ? "warn" : "ok" },
      { id: "quality", label: "单品状态", value: blockedItems.length ? "有禁用" : retakeItems.length ? "有待重拍" : "正常", status: blockedItems.length ? "bad" : retakeItems.length ? "warn" : "ok" }
    ]
  };
}

function renderPromptTemplate(template, { occasion, weatherInfo, date }) {
  const season = seasonForDate(date || weatherInfo?.date);
  const weatherText = weatherInfo
    ? `${weatherInfo.condition}, ${weatherInfo.tempMin}-${weatherInfo.tempMax}°C${weatherInfo.precipitation !== null ? `, precipitation probability ${weatherInfo.precipitation}%` : ""}`
    : "";
  const variables = {
    occasion: occasion || "",
    weather: weatherText,
    temperature: weatherInfo ? `${weatherInfo.tempMin}-${weatherInfo.tempMax}°C` : "",
    city: weatherInfo?.city || "",
    date: weatherInfo?.date || date || "",
    season
  };
  let rendered = String(template || "").replace(/\{\{\s*(occasion|weather|temperature|city|date|season)\s*\}\}/gi, (_, key) => variables[key.toLowerCase()] || "");

  return rendered.trim();
}

function seasonForDate(dateValue) {
  if (!dateValue) return "";
  const month = new Date(`${dateValue}T12:00:00`).getMonth() + 1;
  if ([12, 1, 2].includes(month)) return "winter";
  if ([3, 4, 5].includes(month)) return "spring";
  if ([6, 7, 8].includes(month)) return "summer";
  return "fall";
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function weatherCodeLabel(code) {
  const labels = {
    0: "晴朗",
    1: "大致晴朗",
    2: "局部多云",
    3: "阴天",
    45: "有雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "小阵雨",
    81: "阵雨",
    82: "强阵雨",
    95: "雷暴",
    96: "雷暴伴小冰雹",
    99: "雷暴伴冰雹"
  };
  return labels[code] || "未知天气";
}

function buildRequestDebug(settings, occasion, userPrompt, finalPrompt, modelAssetId, selectedItems, weatherInfo) {
  return {
    createdAt: new Date().toISOString(),
    endpoint: settings.endpoint,
    provider: settings.provider,
    occasion,
    weather: weatherInfo,
    userPrompt,
    finalPrompt,
    modelAssetId,
    selectedItems: selectedItems.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      tags: item.tags,
      quality: getItemQuality(item),
      imageAssetId: item.imageAssetId,
      cutoutAssetId: item.cutoutAssetId || "",
      generationMode: "image",
      uploadsImageToModel: true
    }))
  };
}

function normalizeSettings(savedSettings) {
  return { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
}

function defaultPromptTemplates() {
  return [
    {
      id: "default-identity-first-tryon",
      name: "身份优先试穿",
      prompt: DEFAULT_PROMPT,
      createdAt: new Date().toISOString()
    },
    {
      id: "default-legacy-stable-tryon",
      name: "稳定试穿（原版）",
      prompt: LEGACY_STABLE_PROMPT,
      createdAt: new Date().toISOString()
    }
  ];
}

function mergeDefaultPromptTemplates(savedTemplates) {
  const templates = Array.isArray(savedTemplates) ? savedTemplates : [];
  const existingIds = new Set(templates.map((template) => template.id));
  const missingDefaults = defaultPromptTemplates().filter((template) => !existingIds.has(template.id));
  return [...missingDefaults, ...templates];
}

function sortByDate(entries) {
  return [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
