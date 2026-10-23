// ===== Weather app (Projects page) =====
// Weather data: UAPI Weather API (uapis.cn), lang=zh → Chinese text, no key.
// City dropdown: Open-Meteo geocoding (language=zh) — matches Chinese or pinyin
// and returns each city together with its province.
document.addEventListener("DOMContentLoaded", () => {
  const app = document.querySelector("#weather-app");
  if (!app) return;

  const form = app.querySelector("#weather-form");
  const input = app.querySelector("#weather-input");
  const statusEl = app.querySelector("#weather-status");
  const dropdownEl = app.querySelector("#weather-suggest");
  const resultEl = app.querySelector("#weather-result");
  const cityEl = app.querySelector("#weather-city");
  const subEl = app.querySelector("#weather-sub");
  const iconEl = app.querySelector("#weather-icon");
  const tempEl = app.querySelector("#weather-temp");
  const descEl = app.querySelector("#weather-desc");
  const metaEl = app.querySelector("#weather-meta");
  const daysEl = app.querySelector("#weather-days");

  const WEATHER_URL = "https://uapis.cn/api/v1/misc/weather";
  const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const DEBOUNCE_MS = 300;

  const MSG = {
    loading: "加载中…",
    empty: "请先输入城市名称。",
    notFound: "没有找到该城市——请检查拼写。",
    multiple: "找到多个城市，请从列表中选择。",
    geoFail: "无法连接城市搜索服务，请稍后重试。",
    weatherFail: "无法连接天气服务，请检查网络后重试。"
  };

  // UAPI weather-icon codes → emoji. Anything outside the known ranges falls
  // back to a keyword match on the condition text (Chinese or English).
  function weatherIcon(code, text) {
    const n = parseInt(code, 10);
    const t = text || "";
    const en = t.toLowerCase();

    if (n === 100) return "☀️";
    if (n === 101 || n === 102) return "🌤️";
    if (n === 103 || n === 153) return "⛅";
    if (n === 104 || n === 151 || n === 152) return "☁️";
    if (n === 150) return "🌙";
    if (n >= 302 && n <= 304) return "⛈️";
    if (n >= 300 && n <= 399) return n === 309 ? "🌦️" : "🌧️";
    if (n >= 400 && n <= 499) return "🌨️";
    if ([503, 504, 507, 508].includes(n)) return "🌪️";
    if (n >= 500 && n <= 515) return "🌫️";
    if (n === 900) return "🥵";
    if (n === 901) return "🥶";

    if (/雷/.test(t) || /thunder|storm/.test(en)) return "⛈️";
    if (/雪|冰雹/.test(t) || /snow|sleet|blizzard/.test(en)) return "🌨️";
    if (/雨/.test(t) || /rain|shower|drizzle/.test(en)) return "🌧️";
    if (/雾|霾|浮尘|沙|尘/.test(t) || /fog|haze|mist|smoke|dust|sand/.test(en)) return "🌫️";
    if (/阴|多云|云/.test(t) || /cloud|overcast/.test(en)) return "☁️";
    if (/晴/.test(t) || /sun|clear|fair/.test(en)) return "☀️";
    return "🌡️";
  }

  function setStatus(message, state) {
    statusEl.textContent = message || "";
    if (state) statusEl.dataset.state = state;
    else delete statusEl.dataset.state;
  }

  // ---- City dropdown (live, debounced) ----
  let places = [];
  let activeIndex = -1;
  let lastQuery = "";
  let debounceTimer = null;
  let seq = 0;

  const label = (p) => (p.admin1 ? `${p.name}（${p.admin1}）` : p.name);

  function closeDropdown() {
    places = [];
    activeIndex = -1;
    dropdownEl.innerHTML = "";
    dropdownEl.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function highlight(index, items) {
    activeIndex = (index + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("is-active", i === activeIndex));
  }

  function renderDropdown(list) {
    places = list;
    activeIndex = -1;
    dropdownEl.innerHTML = "";
    list.forEach((place, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "weather-dropdown-item";
      btn.dataset.index = String(i);
      btn.textContent = label(place);
      li.appendChild(btn);
      dropdownEl.appendChild(li);
    });
    dropdownEl.hidden = list.length === 0;
    input.setAttribute("aria-expanded", String(list.length > 0));
  }

  // Chinese or pinyin in → matching cities (with province) out.
  async function fetchPlaces(query) {
    const res = await fetch(
      `${GEO_URL}?name=${encodeURIComponent(query)}&count=8&language=zh&format=json`
    );
    if (!res.ok) throw new Error("geocoding failed");
    const data = await res.json();
    // Keep populated places (real cities/towns), drop airports and other
    // non-city features; then list Chinese cities first.
    const list = (data.results || []).filter(
      (p) => !p.feature_code || p.feature_code.startsWith("PPL")
    );
    return list
      .slice()
      .sort(
        (a, b) => (b.country_code === "CN" ? 1 : 0) - (a.country_code === "CN" ? 1 : 0)
      );
  }

  async function loadPlaces(query) {
    const mySeq = ++seq;
    try {
      const list = await fetchPlaces(query);
      if (mySeq !== seq || input.value.trim() !== query) return; // stale response
      lastQuery = query;
      if (!list.length) {
        closeDropdown();
        setStatus(MSG.notFound, "error");
        return;
      }
      setStatus("");
      renderDropdown(list);
    } catch (err) {
      if (mySeq !== seq) return;
      setStatus(MSG.geoFail, "error");
    }
  }

  function choose(place) {
    closeDropdown();
    input.value = place.name;
    search(place.name);
  }

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(debounceTimer);
    if (!query) {
      closeDropdown();
      setStatus("");
      return;
    }
    debounceTimer = setTimeout(() => loadPlaces(query), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (dropdownEl.hidden) return;
    const items = dropdownEl.querySelectorAll(".weather-dropdown-item");
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight(activeIndex + 1, items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(activeIndex - 1, items);
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  });

  dropdownEl.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".weather-dropdown-item");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (index === activeIndex) return;
    highlight(index, dropdownEl.querySelectorAll(".weather-dropdown-item"));
  });

  dropdownEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".weather-dropdown-item");
    if (!btn) return;
    const place = places[Number(btn.dataset.index)];
    if (place) choose(place);
  });

  // ---- Weather (UAPI, Chinese) ----
  async function fetchWeather(city) {
    const params = new URLSearchParams({
      city,
      lang: "zh",
      extended: "true",
      forecast: "true"
    });
    const res = await fetch(`${WEATHER_URL}?${params.toString()}`);
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* non-JSON response */
    }
    if (!res.ok) {
      const err = new Error((body && body.error) || "weather request failed");
      err.status = res.status;
      err.code = body && body.error;
      throw err;
    }
    return body;
  }

  function render(data) {
    cityEl.textContent = data.city || data.province || "";
    subEl.textContent = [data.district, data.province]
      .filter((part) => part && part !== data.city)
      .join(" · ");

    iconEl.textContent = weatherIcon(data.weather_icon, data.weather);
    tempEl.textContent = `${Math.round(data.temperature)}°C`;
    descEl.textContent = data.weather || "";

    const metaRows = [];
    if (data.feels_like != null) metaRows.push(["体感温度", `${Math.round(data.feels_like)}°C`]);
    if (data.humidity != null) metaRows.push(["湿度", `${data.humidity}%`]);
    const wind = [data.wind_direction, data.wind_power].filter(Boolean).join(" ");
    if (wind) metaRows.push(["风力", wind]);
    metaEl.innerHTML = metaRows
      .map(([k, v]) => `<li><span class="k">${k}</span><span class="v">${v}</span></li>`)
      .join("");

    const days = (data.forecast || []).slice(0, 5);
    daysEl.innerHTML = days
      .map((d) => {
        const dow =
          d.week ||
          new Date(d.date + "T00:00:00").toLocaleDateString("zh-CN", { weekday: "short" });
        const ic = weatherIcon(null, d.weather_day);
        const hi = d.temp_max != null ? `${Math.round(d.temp_max)}°` : "";
        const lo = d.temp_min != null ? `${Math.round(d.temp_min)}°` : "";
        return (
          `<div class="weather-day">` +
          `<div class="dow">${dow}</div>` +
          `<div class="ic" aria-hidden="true">${ic}</div>` +
          `<div class="hi">${hi}</div>` +
          `<div class="lo">${lo}</div>` +
          `</div>`
        );
      })
      .join("");
  }

  async function search(city) {
    setStatus(MSG.loading, "loading");
    resultEl.hidden = true;
    closeDropdown();

    try {
      const data = await fetchWeather(city);
      render(data);
      setStatus("");
      resultEl.hidden = false;
    } catch (err) {
      // The API reports an unknown city as 404 LOCATION_NOT_FOUND.
      if (err.status === 404 && err.code === "LOCATION_NOT_FOUND") {
        setStatus(MSG.notFound, "error");
      } else {
        setStatus(MSG.weatherFail, "error");
      }
    }
  }

  // On Search/Enter: use the highlighted candidate, accept a unique match, or
  // ask the user to pick from the list — the first of several is never chosen
  // automatically.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) {
      input.focus();
      closeDropdown();
      setStatus(MSG.empty, "error");
      return;
    }

    if (!dropdownEl.hidden && activeIndex >= 0 && places[activeIndex]) {
      choose(places[activeIndex]);
      return;
    }

    if (!dropdownEl.hidden && lastQuery === query && places.length) {
      if (places.length === 1) choose(places[0]);
      else setStatus(MSG.multiple, "hint");
      return;
    }

    setStatus(MSG.loading, "loading");
    try {
      const list = await fetchPlaces(query);
      lastQuery = query;
      if (list.length === 1) {
        choose(list[0]);
      } else if (list.length > 1) {
        renderDropdown(list);
        setStatus(MSG.multiple, "hint");
      } else {
        closeDropdown();
        setStatus(MSG.notFound, "error");
      }
    } catch (err) {
      setStatus(MSG.geoFail, "error");
    }
  });
});
