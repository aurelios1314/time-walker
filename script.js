// ==========================================================================
// 时行 1.0 - 核心驱动引擎 (经典单体版)
// 包含：日历流转、天气监测、事项管理、八字排盘、天机推演、漫游舞台
// ==========================================================================

// ==========================================
// Ⅰ. AI 洞察引擎配置 (原 insight.js 合并)
// ==========================================
const INSIGHT_CONFIG = {
  DEFAULT_API_KEY: 'sk-f61dc56ee54248a4aed1c28347b5c00a', // 默认内置 DeepSeek API Key
  API_URL: 'https://api.deepseek.com/chat/completions',
  MODEL: 'deepseek-chat',
  SYSTEM_PROMPT: `你是一位精通天时地利人和的资深谋士，名为『时行君』。
你的使命是基于用户提供的【天时】、【地利】、【人和】与【我】(命理近况)，推演出今日的四张“时机灵牌”。
【四大灵牌要求】：
1. type: "yun" (运·气场)：基于天时与八字，定调气场。
2. type: "mou" (谋·破局)：基于人和待办与天时地利，给战术。
3. type: "xin" (心·疗愈)：基于健康状况，给抚慰。
4. type: "zhi" (知·天时)：基于节气黄历做隐喻。
严格输出 JSON 数组格式，不要包含 markdown 标记：[{"type":"yun","title":"...","content":"..."},...]`
};

async function fetchTimeInsight(contextText) {
  const key = localStorage.getItem('shixing_api_key') || INSIGHT_CONFIG.DEFAULT_API_KEY;
  let url = localStorage.getItem('shixing_api_host') || INSIGHT_CONFIG.API_URL;
  if (!url.endsWith('/chat/completions')) {
    url = url.replace(/\/+$/, '') + '/chat/completions';
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: INSIGHT_CONFIG.MODEL, messages: [{ role: "system", content: INSIGHT_CONFIG.SYSTEM_PROMPT }, { role: "user", content: contextText }], stream: false })
  });
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const data = await response.json();
  let rawText = data.choices[0].message.content.trim();
  if (rawText.startsWith('```json')) rawText = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  else if (rawText.startsWith('```')) rawText = rawText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(rawText);
}

async function fetchDeepSeekChat(messages) {
  const key = localStorage.getItem('shixing_api_key') || INSIGHT_CONFIG.DEFAULT_API_KEY;
  let url = localStorage.getItem('shixing_api_host') || INSIGHT_CONFIG.API_URL;
  if (!url.endsWith('/chat/completions')) {
    url = url.replace(/\/+$/, '') + '/chat/completions';
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: INSIGHT_CONFIG.MODEL, messages: messages, stream: false })
  });
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

(() => {
  // ==========================================
  // Ⅱ. 全局状态与 DOM 绑定
  // ==========================================
  const d = document, get = id => d.getElementById(id);
  const monthGroupText = get('monthGroupText'), locationValue = get('locationValue'), calendarGrid = get('calendarGrid');
  const prevBtn = get('prevBtn'), nextBtn = get('nextBtn'), todayBtn = get('todayBtn');
  const detailTitleText = get('detailTitleText'), detailWeather = get('detailWeather'), detailNextSolar = get('detailNextSolar'), detailNextLunar = get('detailNextLunar'), detailNextJieqi = get('detailNextJieqi');
  const scheduleStats = get('scheduleStats'), scheduleList = get('scheduleList'), scheduleEmpty = get('scheduleEmpty');
  const insightPanel = get('insightPanel'), stageBody = get('stageBody'), insightStageOverlay = get('insightStageOverlay');
  
  const now = new Date();
  let currentYear = now.getFullYear(), currentMonth = now.getMonth();
  const todayLunar = Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunar();
  let currentLunarYear = todayLunar.getYear(), currentLunarMonth = todayLunar.getMonth();
  let weatherByDate = new Map(), tasks = [], selectedTaskDate = null;
  let userGeo = { latitude: 39.9042, longitude: 116.4074, province: '北京市', city: '北京市' };
  let isAiLoading = false, dailyTarotData = null, isRoundMode = false;
  let activePanelId = 'calendar';
  let chatHistory = [];
  
  const ymd = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

  // ==========================================
  // Ⅲ. 气象监测引擎 (Open-Meteo)
  // ==========================================
  async function fetchWeather15Days() {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${userGeo.latitude}&longitude=${userGeo.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min&hourly=temperature_2m,weathercode&timezone=Asia%2FShanghai&past_days=1&forecast_days=14`);
      const data = await res.json();
      weatherByDate.clear();
      data.daily.time.forEach((t, i) => {
        const [y, m, d_str] = t.split('-');
        const dateKey = `${y}-${parseInt(m)}-${parseInt(d_str)}`;
        weatherByDate.set(dateKey, {
          max: Math.round(data.daily.temperature_2m_max[i]),
          min: Math.round(data.daily.temperature_2m_min[i]),
          code: data.daily.weathercode[i],
          hourly: data.hourly.time.map((ht, hi) => ({ time: ht, temp: data.hourly.temperature_2m[hi], code: data.hourly.weathercode[hi] })).filter(h => h.time.startsWith(t))
        });
      });
      if (selectedTaskDate) updateDetailPanel(selectedTaskDate);
    } catch (e) {
      detailWeather.textContent = '天象获取失败';
    }
  }

  function parseWeatherCode(code) {
    if (code === 0) return { t: '晴', i: '☀️' };
    if ([1, 2, 3].includes(code)) return { t: '多云', i: '⛅' };
    if ([45, 48].includes(code)) return { t: '雾', i: '🌫️' };
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return { t: '雨', i: '🌧️' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { t: '雪', i: '❄️' };
    if ([95, 96, 99].includes(code)) return { t: '雷暴', i: '⛈️' };
    return { t: '未知', i: '🌀' };
  }

  function renderHourlyWeather(hourly) {
    const overlay = get('hourlyWeatherOverlay');
    const container = get('hourlyWeatherContainer');
    if (!overlay || !container) return;

    container.innerHTML = '';
    hourly.forEach(h => {
      const timePart = h.time.split('T')[1]; // HH:MM
      const weatherInfo = parseWeatherCode(h.code);
      const hourDiv = d.createElement('div');
      hourDiv.style.cssText = 'display:flex; flex-direction:column; align-items:center; min-width:64px; background:#fbfaf8; border:1px solid rgba(47, 37, 34, 0.08); border-radius:10px; padding:10px; font-size:12px;';
      hourDiv.innerHTML = `
        <span style="color:var(--muted); font-size:10px;">${timePart}</span>
        <span style="font-size:22px; margin:6px 0;">${weatherInfo.i}</span>
        <span style="font-weight:700; color:var(--ink);">${Math.round(h.temp)}°</span>
        <span style="color:var(--muted); font-size:9px; margin-top:2px;">${weatherInfo.t}</span>
      `;
      container.appendChild(hourDiv);
    });
    overlay.style.display = 'flex';
  }

  // ==========================================
  // Ⅳ. 日历流转与详情渲染 (Lunar)
  // ==========================================
  function getLunarFestivalsForDate(l) {
    const month = l.getMonth();
    const day = l.getDay();
    const fests = [];

    // Check custom lunar festival definitions
    if (month === 1 && day === 1) fests.push("春节");
    if (month === 1 && day === 15) fests.push("元宵节");
    if (month === 2 && day === 2) fests.push("龙抬头");
    if (month === 2 && day === 12) fests.push("花朝节");
    if (month === 3 && day === 3) fests.push("上巳节");
    if (month === 4 && day === 8) fests.push("佛诞节");
    if (month === 5 && day === 5) fests.push("端午节");
    if (month === 7 && day === 7) fests.push("七夕节");
    if (month === 7 && day === 15) fests.push("中元节");
    if (month === 8 && day === 15) fests.push("中秋节");
    if (month === 9 && day === 9) fests.push("重阳节");
    if (month === 10 && day === 1) fests.push("寒衣节");
    if (month === 10 && day === 15) fests.push("下元节");
    if (month === 12 && day === 8) fests.push("腊八节");
    if (month === 12 && day === 23) fests.push("小年");
    if (month === 12 && day === 24) fests.push("小年");
    
    // Check for 除夕 (Lunar New Year's Eve)
    const nextDay = l.next(1);
    if (nextDay.getMonth() === 1 && nextDay.getDay() === 1) {
      fests.push("除夕");
    }

    // Merge library festivals if not already present
    l.getFestivals().forEach(f => {
      if (f && !fests.includes(f)) {
        fests.push(f);
      }
    });

    return fests;
  }

  function renderCalendar(year, month) {
    calendarGrid.innerHTML = '';
    const firstDay = new Date(year, month, 1).getDay();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    const midSolar = Solar.fromYmd(year, month + 1, 15);
    const midLunar = midSolar.getLunar();
    monthGroupText.textContent = `${year}年 · ${midLunar.getYearInGanZhi()}年 · ${midLunar.getMonthInChinese()}月`;

    let totalCells = 42;
    for (let i = 0; i < totalCells; i++) {
      const cell = d.createElement('div');
      cell.className = 'calendar-day';
      let cYear = year, cMonth = month, cDate;

      if (i < startOffset) {
        cMonth--; if (cMonth < 0) { cMonth = 11; cYear--; }
        cDate = prevMonthDays - startOffset + i + 1;
        cell.classList.add('other-month');
      } else if (i >= startOffset + daysInMonth) {
        cMonth++; if (cMonth > 11) { cMonth = 0; cYear++; }
        cDate = i - startOffset - daysInMonth + 1;
        cell.classList.add('other-month');
      } else {
        cDate = i - startOffset + 1;
        if (cYear === now.getFullYear() && cMonth === now.getMonth() && cDate === now.getDate()) {
          cell.classList.add('is-today');
        }
        if (selectedTaskDate && cYear === selectedTaskDate.getFullYear() && cMonth === selectedTaskDate.getMonth() && cDate === selectedTaskDate.getDate()) {
          cell.classList.add('selected');
        }
      }

      const cellDateKey = `${cYear}-${cMonth + 1}-${cDate}`;
      const solarObj = Solar.fromYmd(cYear, cMonth + 1, cDate);
      const lunar = solarObj.getLunar();
      const jieqi = lunar.getJieQi();
      const dayTasks = tasks.filter(t => t.date === cellDateKey);
      
      if (jieqi) cell.classList.add('has-jieqi');

      // 公历节日
      const sFests = solarObj.getFestivals().filter(Boolean);
      const solarFestHtml = sFests.length ? `<span class="day-solar-fest" title="${sFests.join('/')}">${sFests[0]}</span>` : '';

      // 农历与节气信息
      const lunarDayText = lunar.getDay() === 1 ? lunar.getMonthInChinese() + '月' : lunar.getDayInChinese();
      const lFests = getLunarFestivalsForDate(lunar);
      const lInfo = jieqi || lFests[0] || '';
      let lunarInfoHtml = '';
      if (lInfo) {
        const isJieQi = lInfo === jieqi;
        lunarInfoHtml = `<span class="day-lunar-info ${isJieQi ? 'is-jieqi' : 'is-fest'}" title="${lInfo}">${lInfo}</span>`;
      }

      let dotsHtml = dayTasks.map(t => `<div class="task-dot ${t.isImportant ? 'important' : ''}"></div>`).join('');
      
      cell.innerHTML = `
        <div style="display:flex; flex-direction:column; justify-content:flex-start; width:100%; flex-grow:1; gap:2px; min-height:32px; box-sizing:border-box;">
          <!-- Top Row: Gregorian and Lunar aligned on baseline -->
          <div style="display:flex; justify-content:space-between; align-items:baseline; width:100%;">
            <span class="day-num">${cDate}</span>
            <span class="lunar-text">${lunarDayText}</span>
          </div>
          <!-- Bottom Row: Solar and Lunar festivals/terms -->
          <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%; gap:4px;">
            <div style="flex:1; min-width:0; text-align:left;">
              ${solarFestHtml}
            </div>
            <div style="flex:1; min-width:0; text-align:right;">
              ${lunarInfoHtml}
            </div>
          </div>
        </div>
        <div class="day-tasks-dots">${dotsHtml}</div>
      `;

      cell.onclick = () => {
        d.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
        selectedTaskDate = new Date(cYear, cMonth, cDate);
        const clickLunar = Solar.fromYmd(cYear, cMonth + 1, cDate).getLunar();
        currentLunarYear = clickLunar.getYear();
        currentLunarMonth = clickLunar.getMonth();
        
        updateDetailPanel(selectedTaskDate);
        renderTasks(selectedTaskDate);
        loadDailyStatusForSelectedDate();
        updateLunarDetailCard(selectedTaskDate);
        
        // Re-render grids to ensure selected state highlights correctly
        renderCalendar(currentYear, currentMonth);
      };
      calendarGrid.appendChild(cell);
    }
  }

  function updateLunarDetailCard(date) {
    const contentEl = get('lunarDetailContent');
    if (!contentEl) return;
    
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    
    const yiList = lunar.getDayYi();
    const jiList = lunar.getDayJi();
    
    contentEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(140, 34, 48, 0.08); padding-bottom: 6px;">
          <span style="font-weight: 700; color: var(--ink);">阴历日期</span>
          <span style="color: var(--muted);">${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(140, 34, 48, 0.08); padding-bottom: 6px;">
          <span style="font-weight: 700; color: var(--ink);">干支纪日</span>
          <span style="font-weight: 600; color: var(--forbidden-red);">${lunar.getYearInGanZhi()}(${lunar.getYearShengXiao()})年 · ${lunar.getMonthInGanZhi()}月 · ${lunar.getDayInGanZhi()}日</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(140, 34, 48, 0.08); padding-bottom: 6px;">
          <span style="font-weight: 700; color: var(--ink);">吉神方位</span>
          <span style="color: var(--muted);">财神${lunar.getPositionCai()} · 喜神${lunar.getPositionXi()} · 福神${lunar.getPositionFu()}</span>
        </div>
        
        <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; gap: 8px; align-items: flex-start;">
            <span style="background: #1e7e34; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; flex-shrink: 0;">宜</span>
            <span style="color: #2b703e; font-weight: 600; line-height: 1.4; font-size: 12.5px;">${yiList.length ? yiList.slice(0, 8).join(' · ') : '诸事不宜'}</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start; margin-top: 4px;">
            <span style="background: var(--forbidden-red); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; flex-shrink: 0;">忌</span>
            <span style="color: var(--forbidden-red); font-weight: 600; line-height: 1.4; font-size: 12.5px;">${jiList.length ? jiList.slice(0, 8).join(' · ') : '诸事皆宜'}</span>
          </div>
        </div>
      </div>
    `;
  }

  function updateNavSummaries(date) {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    
    // 1. Calendar Summary
    const calendarSum = get('navSumCalendar');
    if (calendarSum) {
      const activeFests = [...solar.getFestivals(), ...getLunarFestivalsForDate(lunar)].filter(Boolean);
      const suffix = activeFests.length ? ` · ${activeFests.join('/')}` : '';
      calendarSum.textContent = `${date.getMonth() + 1}月${date.getDate()}日 ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}${suffix}`;
    }

    // Lunar Summary
    const lunarSum = get('navSumLunar');
    if (lunarSum) {
      const customLFests = getLunarFestivalsForDate(lunar);
      const suffix = customLFests.length ? ` · ${customLFests.join('/')}` : '';
      lunarSum.textContent = `${lunar.getYearInGanZhi()}年 · ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}${suffix}`;
    }

    // 2. Weather Summary
    const weatherSum = get('navSumWeather');
    if (weatherSum) {
      const w = weatherByDate.get(ymd(date));
      if (w) {
        const info = parseWeatherCode(w.code);
        weatherSum.textContent = `${info.t} ${w.min}° / ${w.max}°`;
      } else {
        weatherSum.textContent = '暂无气象数据';
      }
    }

    // 3. Jieqi Summary
    const jieqiSum = get('navSumJieqi');
    if (jieqiSum) {
      let nextJieqi = lunar.getNextJieQi(true);
      if (nextJieqi) {
        const nName = nextJieqi.getName();
        const nDays = nextJieqi.getSolar().subtract(solar);
        jieqiSum.textContent = `${nName} (${nDays}天后)`;
      } else {
        jieqiSum.textContent = '暂无节气';
      }
    }

    // 4. Festival Summary
    const festivalSum = get('navSumFestival');
    if (festivalSum) {
      let nextSolarText = '暂无节日';
      let tempDateSolar = new Date(date);
      for (let i = 0; i < 180; i++) {
        const tempSolar = Solar.fromYmd(tempDateSolar.getFullYear(), tempDateSolar.getMonth() + 1, tempDateSolar.getDate());
        const tempLunar = tempSolar.getLunar();
        const fests = tempSolar.getFestivals();
        const lFests = getLunarFestivalsForDate(tempLunar);
        const allFests = [...fests, ...lFests].filter(Boolean);
        if (allFests.length) {
          const daysText = i === 0 ? '今天' : `${i}天后`;
          nextSolarText = `${allFests[0]} (${daysText})`;
          break;
        }
        tempDateSolar.setDate(tempDateSolar.getDate() + 1);
      }
      festivalSum.textContent = nextSolarText;
    }

    // 5. Tasks Summary
    const tasksSum = get('navSumTasks');
    if (tasksSum) {
      const dayTasks = tasks.filter(t => t.date === ymd(date));
      const pendingCount = dayTasks.filter(t => !t.completed).length;
      tasksSum.textContent = `今日 ${dayTasks.length} 项，待办 ${pendingCount} 项`;
    }
  }

  function renderWeatherPanel(date) {
    const w = weatherByDate.get(ymd(date));
    const mainEl = get('detailWeather');
    const container = get('hourlyWeatherContainer');
    if (!mainEl || !container) return;

    if (w) {
      const info = parseWeatherCode(w.code);
      mainEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:16px;">
          <span style="font-size:48px;">${info.i}</span>
          <div style="text-align:left;">
            <div style="font-size:24px; font-weight:800; color:var(--ink);">${info.t}</div>
            <div style="font-size:14px; color:var(--muted); margin-top:4px;">温度区间：${w.min}°C ~ ${w.max}°C</div>
          </div>
        </div>
      `;
      
      container.innerHTML = '';
      w.hourly.forEach(h => {
        const timePart = h.time.split('T')[1]; // HH:MM
        const weatherInfo = parseWeatherCode(h.code);
        const hourCard = d.createElement('div');
        hourCard.className = 'weather-hourly-card';
        hourCard.innerHTML = `
          <span>${timePart}</span>
          <span style="font-size:20px;">${weatherInfo.i}</span>
          <span class="temp">${Math.round(h.temp)}°</span>
          <span style="font-size:9px;">${weatherInfo.t}</span>
        `;
        container.appendChild(hourCard);
      });
    } else {
      mainEl.innerHTML = `<div style="padding:24px; color:var(--muted);">此日期暂无气象数据（仅支持当前及未来14天预报）</div>`;
      container.innerHTML = '';
    }
  }

  function renderJieqiPanel(date) {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    const heroEl = get('detailNextJieqi');
    const listEl = get('jieqiYearList');
    if (!heroEl || !listEl) return;

    const dayGanZhi = `${lunar.getYearInGanZhi()}年 · ${lunar.getMonthInGanZhi()}月 · ${lunar.getDayInGanZhi()}日`;

    let nextJieqi = lunar.getNextJieQi(true);
    let nName = nextJieqi ? nextJieqi.getName() : '未知';
    let nDays = nextJieqi ? nextJieqi.getSolar().subtract(solar) : 0;
    let nDateStr = nextJieqi ? `${nextJieqi.getSolar().getMonth()}月${nextJieqi.getSolar().getDay()}日` : '';

    heroEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: stretch; width: 100%; gap: 16px;">
        <div style="display: flex; flex-direction: column; justify-content: center; gap: 6px; flex: 1; text-align: left; border-right: 1px solid rgba(140, 34, 48, 0.1); padding-right: 16px;">
          <span style="font-size: 10px; color: var(--muted);">今日天时干支</span>
          <span style="font-size: 16px; color: var(--forbidden-red); font-weight: 800; line-height: 1.3;">${dayGanZhi}</span>
        </div>
        <div style="display: flex; flex-direction: column; justify-content: center; gap: 6px; flex: 1; text-align: left; padding-left: 8px;">
          <span style="font-size: 10px; color: var(--muted);">下一个节气</span>
          <span style="font-size: 16px; color: var(--ink); font-weight: 800; line-height: 1.3;">${nName}</span>
          <span style="font-size: 12px; color: var(--forbidden-red); font-weight: 600;">${nDays} 天后 (${nDateStr})</span>
        </div>
      </div>
    `;

    listEl.innerHTML = '';
    const termYear = date.getFullYear();
    const terms = [];
    let tempDate = new Date(termYear, 0, 1);
    const todayYmd = ymd(now);
    const dateYmd = ymd(date);
    
    while (tempDate.getFullYear() === termYear) {
      const s = Solar.fromYmd(tempDate.getFullYear(), tempDate.getMonth() + 1, tempDate.getDate());
      const l = s.getLunar();
      const jq = l.getJieQi();
      if (jq) {
        const jqDate = new Date(tempDate);
        const jqYmd = ymd(jqDate);
        terms.push({
          name: jq,
          date: jqDate,
          dateStr: `${jqDate.getMonth() + 1}月${jqDate.getDate()}日`,
          passed: jqDate < now && ymd(jqDate) !== todayYmd,
          active: jqYmd === dateYmd
        });
      }
      tempDate.setDate(tempDate.getDate() + 1);
    }
    
    terms.forEach(t => {
      const card = d.createElement('div');
      card.className = `jieqi-year-card ${t.passed ? 'passed' : ''} ${t.active ? 'active' : ''}`;
      card.innerHTML = `
        <span class="name">${t.name}</span>
        <span class="date">${t.dateStr}</span>
      `;
      listEl.appendChild(card);
    });
  }

  function renderFestivalPanel(date) {
    const solarListEl = get('festivalSolarList');
    const lunarListEl = get('festivalLunarList');
    if (!solarListEl || !lunarListEl) return;

    solarListEl.innerHTML = '';
    lunarListEl.innerHTML = '';

    const solarFests = [];
    const lunarFests = [];
    let tempDate = new Date(date);
    
    for (let i = 0; i < 180; i++) {
      const s = Solar.fromYmd(tempDate.getFullYear(), tempDate.getMonth() + 1, tempDate.getDate());
      const l = s.getLunar();
      
      const sFests = s.getFestivals().filter(Boolean);
      const lFests = getLunarFestivalsForDate(l);
      
      const diffTime = tempDate.getTime() - date.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      sFests.forEach(f => {
        solarFests.push({
          name: f,
          dateStr: `${tempDate.getMonth() + 1}月${tempDate.getDate()}日`,
          daysLeft: diffDays
        });
      });
      
      lFests.forEach(f => {
        lunarFests.push({
          name: f,
          dateStr: `${l.getMonthInChinese()}月${l.getDayInChinese()} (公历${tempDate.getMonth() + 1}月${tempDate.getDate()}日)`,
          daysLeft: diffDays
        });
      });

      tempDate.setDate(tempDate.getDate() + 1);
    }

    const uniqueSolarFests = [];
    const solarKeys = new Set();
    solarFests.forEach(f => {
      const key = `${f.name}-${f.dateStr}`;
      if (!solarKeys.has(key)) {
        solarKeys.add(key);
        uniqueSolarFests.push(f);
      }
    });

    const uniqueLunarFests = [];
    const lunarKeys = new Set();
    lunarFests.forEach(f => {
      const key = `${f.name}-${f.dateStr}`;
      if (!lunarKeys.has(key)) {
        lunarKeys.add(key);
        uniqueLunarFests.push(f);
      }
    });

    if (uniqueSolarFests.length === 0) {
      solarListEl.innerHTML = '<div class="schedule-empty">未来180天无公历节日</div>';
    } else {
      uniqueSolarFests.slice(0, 15).forEach(f => {
        const item = d.createElement('div');
        item.className = 'festival-item';
        const daysText = f.daysLeft === 0 ? '今天' : `${f.daysLeft}天后`;
        item.innerHTML = `
          <span class="festival-name">${f.name}</span>
          <div class="festival-date-info">
            <span class="festival-solar-date">${f.dateStr}</span>
            <span class="festival-days-left ${f.daysLeft === 0 ? 'today' : ''}">${daysText}</span>
          </div>
        `;
        solarListEl.appendChild(item);
      });
    }

    if (uniqueLunarFests.length === 0) {
      lunarListEl.innerHTML = '<div class="schedule-empty">未来180天无农历节日</div>';
    } else {
      uniqueLunarFests.slice(0, 15).forEach(f => {
        const item = d.createElement('div');
        item.className = 'festival-item';
        const daysText = f.daysLeft === 0 ? '今天' : `${f.daysLeft}天后`;
        item.innerHTML = `
          <span class="festival-name">${f.name}</span>
          <div class="festival-date-info">
            <span class="festival-solar-date">${f.dateStr}</span>
            <span class="festival-days-left ${f.daysLeft === 0 ? 'today' : ''}">${daysText}</span>
          </div>
        `;
        lunarListEl.appendChild(item);
      });
    }
  }

  function updateProfilePanelDisplay() {
    const displayEl = get('profilePanelDisplay');
    if (!displayEl) return;
    const profileStr = localStorage.getItem('shixing_profile');
    if (profileStr) {
      const p = JSON.parse(profileStr);
      displayEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:14px; font-weight:700; color:var(--forbidden-red);">${p.gender === '女' ? '坤造' : '乾造'} · 出生历法分析</span>
            <span style="font-size:11px; color:var(--muted);">${p.date} ${p.time}</span>
          </div>
          ${p.bazi}
        </div>
      `;
    } else {
      displayEl.innerHTML = `
        <div style="font-size: 13px; color: var(--muted); padding: 24px; text-align: center; border: 1px dashed rgba(138,127,121,0.2); border-radius: 12px;">
          点击右上角「编辑档案」，填写出生信息和状态标签
        </div>
      `;
    }
  }

  function switchPanel(panelId) {
    activePanelId = panelId;
    d.querySelectorAll('.nav-card').forEach(card => {
      if (card.getAttribute('data-panel') === panelId) {
        card.classList.add('nav-active');
      } else {
        card.classList.remove('nav-active');
      }
    });

    d.querySelectorAll('.main-panel').forEach(panel => {
      if (panel.id === `panel-${panelId}`) {
        panel.classList.add('is-active');
      } else {
        panel.classList.remove('is-active');
      }
    });

    refreshActivePanel();
  }

  function refreshActivePanel() {
    if (!selectedTaskDate) selectedTaskDate = now;
    
    switch (activePanelId) {
      case 'calendar':
        renderCalendar(currentYear, currentMonth);
        updateLunarDetailCard(selectedTaskDate);
        break;
      case 'weather':
        renderWeatherPanel(selectedTaskDate);
        break;
      case 'jieqi':
        renderJieqiPanel(selectedTaskDate);
        break;
      case 'festival':
        renderFestivalPanel(selectedTaskDate);
        break;
      case 'profile':
        updateProfilePanelDisplay();
        break;
      case 'tasks':
        renderTasks(selectedTaskDate);
        break;
      case 'insight':
        const dateKey = `shixing_tarot_${ymd(selectedTaskDate)}`;
        const cachedStr = localStorage.getItem(dateKey);
        const promptArea = get('insightPanel');
        const stageContainer = get('stageBody');
        const roundBtn = get('insightRoundBtn');
        
        if (cachedStr) {
          if (promptArea) promptArea.style.display = 'none';
          if (stageContainer) stageContainer.style.display = 'block';
          if (roundBtn) {
            roundBtn.style.display = 'inline-block';
            roundBtn.textContent = isRoundMode ? "一键：展开长轴" : "一键：绕线成钟";
          }
          dailyTarotData = JSON.parse(cachedStr);
          renderInsightStage(dailyTarotData, isRoundMode ? 'round' : 'linear');
        } else {
          if (promptArea) {
            promptArea.style.display = 'flex';
            const panelDesc = get('insightPanelDesc');
            if (panelDesc) panelDesc.innerHTML = '点击窥伺今日天时、地利、人和之交汇局势';
          }
          if (stageContainer) stageContainer.style.display = 'none';
          if (roundBtn) roundBtn.style.display = 'none';
        }
        break;
    }
  }

  function updateDetailPanel(date) {
    const isToday = ymd(date) === ymd(now);
    if (detailTitleText) {
      detailTitleText.textContent = isToday ? '📅 岁事纪实 (今天)' : `📅 岁事纪实 (${date.getMonth() + 1}月${date.getDate()}日)`;
    }
    
    // 天气
    const w = weatherByDate.get(ymd(date));
    if (detailWeather) {
      if (w) {
        const info = parseWeatherCode(w.code);
        detailWeather.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><span style="font-size:24px;">${info.i}</span><div style="display:flex; flex-direction:column;"><span style="font-size:14px; font-weight:700;">${info.t} ${w.min}° / ${w.max}°</span><span style="font-size:10px; color:var(--muted);">点击查看24小时流变</span></div></div>`;
      } else {
        detailWeather.textContent = '气象暂不可知';
      }
    }

    // 节气与节日
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    
    // 真正计算“下一个”公历节日
    let nextSolarText = '暂无';
    let tempDateSolar = new Date(date);
    for (let i = 0; i < 180; i++) {
      const tempSolar = Solar.fromYmd(tempDateSolar.getFullYear(), tempDateSolar.getMonth() + 1, tempDateSolar.getDate());
      const fests = tempSolar.getFestivals().filter(Boolean);
      if (fests.length) {
        const daysText = i === 0 ? '今天' : `${i}天后`;
        nextSolarText = `${fests.join('/')} (${daysText})`;
        break;
      }
      tempDateSolar.setDate(tempDateSolar.getDate() + 1);
    }
    if (detailNextSolar) detailNextSolar.textContent = nextSolarText;

    // 真正计算“下一个”农历节日
    let nextLunarText = '暂无';
    let tempDateLunar = new Date(date);
    for (let i = 0; i < 180; i++) {
      const tempSolar = Solar.fromYmd(tempDateLunar.getFullYear(), tempDateLunar.getMonth() + 1, tempDateLunar.getDate());
      const tempLunar = tempSolar.getLunar();
      const fests = getLunarFestivalsForDate(tempLunar);
      if (fests.length) {
        const daysText = i === 0 ? '今天' : `${i}天后`;
        nextLunarText = `${fests.join('/')} (${daysText})`;
        break;
      }
      tempDateLunar.setDate(tempDateLunar.getDate() + 1);
    }
    if (detailNextLunar) detailNextLunar.textContent = nextLunarText;

    let currentJieqi = lunar.getJieQi();
    let nextJieqi = lunar.getNextJieQi(true);
    let nName = nextJieqi ? nextJieqi.getName() : '未知';
    let nDays = nextJieqi ? nextJieqi.getSolar().subtract(solar) : 0;
    let nDateStr = nextJieqi ? `${nextJieqi.getSolar().getMonth()}月${nextJieqi.getSolar().getDay()}日` : '';

    if (detailNextJieqi) {
      detailNextJieqi.innerHTML = `
        <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px; text-align: center; width: 100%;">
          <span style="font-size: 11px; color: #8a7f79; line-height: 1; letter-spacing: 0.5px;">下一个节气</span>
          <span style="font-size: 18px; color: var(--forbidden-red); font-weight: 800; line-height: 1.3; margin: 4px 0;">${nName}</span>
          <span style="font-size: 13px; color: var(--ink); font-weight: 500; line-height: 1.2;">${nDays}天后 (${nDateStr})</span>
        </div>`;
    }

    updateNavSummaries(date);
  }

  // ==========================================
  // Ⅴ. 事项管理与今日随心记
  // ==========================================
  function loadTasks() {
    try { tasks = JSON.parse(localStorage.getItem('shixing_tasks') || '[]'); } catch(e) { tasks = []; }
  }
  
  function renderTasks(date) {
    const dateKey = ymd(date);
    const dayTasks = tasks.filter(t => t.date === dateKey);
    if (scheduleStats) {
      scheduleStats.textContent = `总计 ${dayTasks.length} 项，待办 ${dayTasks.filter(t=>!t.completed).length} 项`;
    }
    
    if (dayTasks.length === 0) {
      if (scheduleEmpty) scheduleEmpty.style.display = 'block';
      if (scheduleList) scheduleList.innerHTML = '';
      return;
    }
    if (scheduleEmpty) scheduleEmpty.style.display = 'none';
    if (scheduleList) {
      scheduleList.innerHTML = dayTasks.map((t, index) => `
        <div style="background:#fff; border:1px solid var(--line); border-radius:6px; padding:6px 8px; display:flex; justify-content:space-between; align-items:center; opacity:${t.completed?0.6:1}; width: 100%; box-sizing: border-box;">
          <div style="display:flex; flex-direction:column; gap:2px; max-width:80%; text-align:left;">
            <span style="font-size:12px; font-weight:600; color:${t.isImportant?'var(--forbidden-red)':'var(--ink)'}; text-decoration:${t.completed?'line-through':'none'}; line-height:1.2; word-break:break-all;">${t.title}</span>
            <span style="font-size:9px; color:var(--muted);">${t.time || '全天'} · ${t.tag || '默认'}</span>
          </div>
          <input type="checkbox" ${t.completed?'checked':''} onchange="window.toggleTask('${dateKey}', ${index})" style="accent-color:var(--forbidden-red); width:14px; height:14px; cursor:pointer;" />
        </div>
      `).join('');
    }
  }

  window.toggleTask = (dateKey, index) => {
    const dayTasks = tasks.filter(t => t.date === dateKey);
    const taskToToggle = dayTasks[index];
    const globalIndex = tasks.findIndex(t => t === taskToToggle);
    if(globalIndex > -1) {
      tasks[globalIndex].completed = !tasks[globalIndex].completed;
      localStorage.setItem('shixing_tasks', JSON.stringify(tasks));
      renderTasks(selectedTaskDate);
      renderCalendar(currentYear, currentMonth);
    }
  };

  // 随心记 (根据选定日期动态加载与保存)
  function loadDailyStatusForSelectedDate() {
    const input = get('dailyStatusInput');
    if (!input) return;
    const dateKey = ymd(selectedTaskDate || now);
    const savedFeelings = JSON.parse(localStorage.getItem('shixing_daily_feelings') || '{}');
    input.value = savedFeelings[dateKey] || '';
  }

  function initDailyStatus() {
    const input = get('dailyStatusInput');
    const saveBtn = get('saveDailyStatusBtn');
    const hint = get('checkinSavedHint');
    if (!input || !saveBtn) return;

    loadDailyStatusForSelectedDate();
    
    const saveStatus = (e) => {
      if (e) e.stopPropagation();
      const val = input.value.trim();
      const dateKey = ymd(selectedTaskDate || now);
      const feelings = JSON.parse(localStorage.getItem('shixing_daily_feelings') || '{}');
      if (val) feelings[dateKey] = val; else delete feelings[dateKey];
      localStorage.setItem('shixing_daily_feelings', JSON.stringify(feelings));
      
      if (hint) {
        hint.textContent = '✅ 已保存';
        hint.style.color = 'var(--forbidden-red)';
        setTimeout(() => { hint.textContent = '随时记录'; hint.style.color = '#d4af37'; }, 2000);
      }
    };
    saveBtn.onclick = saveStatus;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveStatus(e); } };
    input.onclick = (e) => e.stopPropagation();
  }

  // ==========================================
  // Ⅵ. 命理档案与八字推演矩阵
  // ==========================================
  const safeSetTags = (key, str) => {
    const arr = str ? str.split('、') : [];
    d.querySelectorAll(`.profile-tags[data-key="${key}"] .p-tag`).forEach(tag => {
      if (arr.includes(tag.textContent)) tag.classList.add('active'); else tag.classList.remove('active');
    });
  };
  const safeGetTags = (key) => {
    return Array.from(d.querySelectorAll(`.profile-tags[data-key="${key}"] .p-tag.active`)).map(el => el.textContent).join('、');
  };

  function updateBazi() {
    const dateStr = get('profileDate').value, timeStr = get('profileTime').value;
    const baziEl = get('profileBaziResult'), textEl = get('profileBaziText');
    if (dateStr && timeStr && window.Solar) {
      try {
        const [y, m, day] = dateStr.split('-').map(Number);
        const [h, min] = timeStr.split(':').map(Number);
        const lunar = Solar.fromYmdHms(y, m, day, h, min, 0).getLunar();
        const baZi = lunar.getEightChar();
        
        const cols = [
          { name: '年柱', gan: baZi.getYearGan(), zhi: baZi.getYearZhi(), wx: baZi.getYearWuXing(), ss: baZi.getYearShiShenGan() },
          { name: '月柱', gan: baZi.getMonthGan(), zhi: baZi.getMonthZhi(), wx: baZi.getMonthWuXing(), ss: baZi.getMonthShiShenGan() },
          { name: '日元', gan: baZi.getDayGan(), zhi: baZi.getDayZhi(), wx: baZi.getDayWuXing(), ss: '日主' },
          { name: '时柱', gan: baZi.getTimeGan(), zhi: baZi.getTimeZhi(), wx: baZi.getTimeWuXing(), ss: baZi.getTimeShiShenGan() }
        ];
        
        let gridHtml = '<div class="bazi-grid">';
        cols.forEach(c => {
          gridHtml += `<div class="bazi-col"><div class="bz-header">${c.name}</div><div class="bz-shishen">${c.ss}</div><div class="bz-char">${c.gan}</div><div class="bz-char">${c.zhi}</div><div class="bz-wuxing">${c.wx}</div></div>`;
        });
        baziEl.innerHTML = gridHtml + '</div>';
        const chars = baziEl.querySelectorAll('.bz-char');
        const baziTextVal = chars.length >= 6 ? `命主：${chars[4].textContent}${chars[5].textContent}日` : '已设定';
        if(textEl) textEl.textContent = baziTextVal;

        // 日主定格算法
        const dayGan = baZi.getDayGan();
        let tags = { personality: '', psych: '', health: '' };
        if (['甲', '乙'].includes(dayGan)) tags = { personality: '坚韧、沉稳、固执', psych: '专注、平和、压抑', health: '精力足、肩颈痛' };
        else if (['丙', '丁'].includes(dayGan)) tags = { personality: '开朗、急躁', psych: '愉悦、释怀、浮躁', health: '气血旺、失眠' };
        else if (['戊', '己'].includes(dayGan)) tags = { personality: '沉稳、固执', psych: '平和、压抑', health: '睡眠佳、疲惫' };
        else if (['庚', '辛'].includes(dayGan)) tags = { personality: '坚韧、敏感', psych: '专注、内耗', health: '精力足、虚弱' };
        else if (['壬', '癸'].includes(dayGan)) tags = { personality: '细致、多疑', psych: '释怀、焦虑', health: '身轻、虚弱' };
        
        safeSetTags('personality', tags.personality); safeSetTags('psych', tags.psych); safeSetTags('health', tags.health);
      } catch(e) { baziEl.textContent = '推演失败，请检查格式'; }
    } else {
      baziEl.textContent = '请先完善出生日期与时间';
      if(textEl) textEl.textContent = "未设定";
      safeSetTags('personality', ''); safeSetTags('psych', ''); safeSetTags('health', '');
    }
  }

  // ==========================================
  // Ⅶ. 天机推演与时机漫游舞台
  // ==========================================
  function buildInsightContext(date) {
    const isToday = ymd(date) === ymd(now);
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    
    let lInfo = { lunarMonthText: lunar.getMonthInChinese(), lunarDayText: lunar.getDayInChinese(), jieqi: lunar.getJieQi(), lunarFestival: lunar.getFestivals()[0] };
    let huangliText = `日柱：${lunar.getDayInGanZhi()}。宜：${lunar.getDayYi().join('、')}。忌：${lunar.getDayJi().join('、')}`;
    let weatherText = weatherByDate.has(ymd(date)) ? `${parseWeatherCode(weatherByDate.get(ymd(date)).code).t}，${weatherByDate.get(ymd(date)).min}°C - ${weatherByDate.get(ymd(date)).max}°C` : '未知';
    
    let dayTasks = tasks.filter(t => t.date === ymd(date) && !t.completed);
    let taskText = dayTasks.length > 0 ? dayTasks.map(t => `- [${t.time||'全天'}] ${t.title}`).join('\n') : '今日无待办';
    
    let profileText = '未设定命理档案';
    try {
      const p = JSON.parse(localStorage.getItem('shixing_profile'));
      const feeling = JSON.parse(localStorage.getItem('shixing_daily_feelings') || '{}')[ymd(date)] || '无记录';
      if(p) profileText = `八字：${p.bazi}。近期性格：${p.personality||'未知'}。心理：${p.psych||'未知'}。健康：${p.health||'未知'}。今日主观状态：${feeling}`;
    } catch(e) {}

    return `
【当前查询日期】${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${isToday ? '(今天)' : ''}
【天时】农历 ${lInfo.lunarMonthText}${lInfo.lunarDayText}。节气/节日：${lInfo.jieqi||'无'}/${lInfo.lunarFestival||'无'}。黄历：${huangliText}。
【地利】坐标：${userGeo.province}${userGeo.city}。天气：${weatherText}。
【人和】当日待办事项（${dayTasks.length}项）：\n${taskText}
【我 · 命主状态】${profileText}`;
  }

  function renderInsightStage(cards, mode = 'linear') {
    const container = get('stageBody');
    if (!container) return;
    
    // Width and height adjusted to fit nicely in the center dashboard panel
    const canvasWidth = mode === 'round' ? 620 : 1000;
    const canvasHeight = 420;
    const shichenZhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    const times = ['23:00', '01:00', '03:00', '05:00', '07:00', '09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00'];
    const seed = new Date().getDate();
    
    const points = [];
    for(let i=0; i<12; i++) {
      let val = 40 + (Math.sin(i * 0.7 + seed) * 30) + (Math.cos(i * 1.3) * 20);
      points.push(Math.max(15, Math.min(95, Math.round(val))));
    }

    let pts = [];
    if (mode === 'linear') {
      const padX = 80, dx = (canvasWidth - padX * 2) / 11;
      pts = points.map((p, i) => ({ x: padX + i * dx, y: canvasHeight * 0.75 - (p / 100) * (canvasHeight * 0.45), val: p, sc: shichenZhi[i], t: times[i] }));
    } else {
      const centerX = canvasWidth / 2, centerY = canvasHeight / 2;
      const radius = Math.min(canvasWidth, canvasHeight) * 0.35;
      pts = points.map((p, i) => {
        const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const r = radius + (p - 50) * 0.6;
        return { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle), val: p, sc: shichenZhi[i], t: times[i] };
      });
    }

    let pathD = `M ${pts[0].x},${pts[0].y} `;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
      if (mode === 'linear' && i === pts.length - 1) break;
      pathD += mode === 'linear' ? `C ${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y} ` : `Q ${mx},${my} ${p1.x},${p1.y} `;
    }
    if (mode === 'round') pathD += 'Z';

    const typeMap = { 'yun': '气场', 'mou': '破局', 'xin': '健康', 'zhi': '天时' };
    
    let svgHtml = `<svg width="${canvasWidth}" height="${canvasHeight}" style="position:absolute; top:0; left:0; z-index:1; overflow:visible; transition: all 0.8s ease;">
      <path d="${pathD}" fill="none" stroke="var(--champagne-gold)" stroke-width="2.5" opacity="0.4" />
      ${pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="var(--champagne-gold)" stroke-width="2"/>
        <text x="${p.x}" y="${p.y + (mode==='linear'?25:16)}" text-anchor="middle" font-size="8" fill="#8a7f79">${p.t}</text>
        <text x="${p.x}" y="${p.y + (mode==='linear'?40:28)}" text-anchor="middle" font-size="11" fill="#5a4a44" font-weight="700">${p.sc}</text>
      `).join('')}</svg>`;

    const cardPositions = [1, 4, 7, 10]; 
    let cardsHtml = cards.map((card, idx) => {
      let p = pts[cardPositions[idx]];
      return `<div class="tarot-card-wrapper ${mode==='round'?'round-card':''}" style="position:absolute; left:${p.x - 65}px; top: ${p.y - 120}px; z-index: 10; width: 130px; height: 210px;">
          <div class="tarot-card" style="width:100%; height:100%;">
            <div class="tarot-face tarot-back" style="padding: 10px; border-radius: 8px;"><div class="tarot-back-pattern" style="width: 100%; height: 100%;"><span style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:rgba(212,175,55,0.4); font-size:12px; font-family:serif; letter-spacing:2px; writing-mode:vertical-rl;">時行</span></div></div>
            <div class="tarot-face tarot-front" style="padding: 10px; border-radius: 8px; justify-content: flex-start; overflow-y: auto;">
              <div class="tarot-type-badge" style="font-size: 8px; padding: 1px 4px; margin-bottom: 6px;">${typeMap[card.type]||'秘'}</div>
              <div class="tarot-title" style="font-size: 13px; margin-bottom: 8px; padding-bottom: 3px; font-weight:700;">${card.title}</div>
              <div class="tarot-desc" style="font-size: 10px; line-height: 1.4; color: #4a3e3b;">${card.content}</div>
            </div>
          </div></div>`;
    }).join('');

    container.innerHTML = `<div style="position:relative; width:${canvasWidth}px; height:${canvasHeight}px; animation: fadeIn 0.8s ease;">${svgHtml}${cardsHtml}</div>`;
    
    container.querySelectorAll('.tarot-card-wrapper').forEach(w => {
      w.onclick = (e) => { e.stopPropagation(); w.classList.toggle('is-flipped'); };
    });
  }

  async function openInsightStage(date) {
    if (isAiLoading) return;
    const roundBtn = get('insightRoundBtn');
    const promptArea = get('insightPanel');
    const stageContainer = get('stageBody');

    const dateKey = `shixing_tarot_${ymd(date)}`;
    let cachedCards = null;
    try { const cachedStr = localStorage.getItem(dateKey); if (cachedStr) cachedCards = JSON.parse(cachedStr); } catch(e) {}

    if (cachedCards && Array.isArray(cachedCards) && cachedCards.length === 4) {
      dailyTarotData = cachedCards;
      if (promptArea) promptArea.style.display = 'none';
      if (stageContainer) stageContainer.style.display = 'block';
      if (roundBtn) {
        roundBtn.style.display = 'inline-block';
        roundBtn.textContent = isRoundMode ? "一键：展开长轴" : "一键：绕线成钟";
      }
      renderInsightStage(cachedCards, isRoundMode ? 'round' : 'linear');
      return;
    }

    isAiLoading = true;
    if (promptArea) {
      const panelDesc = get('insightPanelDesc');
      if (panelDesc) {
        panelDesc.innerHTML = `<span style="color: var(--forbidden-red); font-weight: 700; display: inline-flex; align-items: center; gap: 6px; animation: fadeIn 0.5s infinite alternate;">☯️ 正在推演天时干支，窥伺吉凶局势...</span>`;
      }
    }

    try {
      let cards = await fetchTimeInsight(buildInsightContext(date));
      dailyTarotData = cards;
      localStorage.setItem(dateKey, JSON.stringify(cards)); 
      
      if (promptArea) promptArea.style.display = 'none';
      if (stageContainer) stageContainer.style.display = 'block';
      if (roundBtn) {
        roundBtn.style.display = 'inline-block';
        roundBtn.textContent = isRoundMode ? "一键：展开长轴" : "一键：绕线成钟";
      }
      renderInsightStage(cards, isRoundMode ? 'round' : 'linear');
    } catch (e) {
      if (promptArea) {
        const panelDesc = get('insightPanelDesc');
        if (panelDesc) {
          panelDesc.innerHTML = `<span style="color: var(--forbidden-red); font-weight: 700;">✦ 天机推演受阻，请检查 API Key 配置或重试 ✦</span>`;
        }
      }
    } finally { 
      isAiLoading = false; 
    }
  }

  // ==========================================
  // Ⅷ. 系统初始化与事件绑定
  // ==========================================
  function renderProfileTagsSummary(p) {
    const summaryEl = get('profileTagsSummary');
    if (!summaryEl) return;
    summaryEl.innerHTML = '';
    
    const normalizeTags = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      return val.split(/[、,]/).map(t => t.trim()).filter(Boolean);
    };

    const tags = [
      ...normalizeTags(p.personality),
      ...normalizeTags(p.psych),
      ...normalizeTags(p.health)
    ];

    if (tags.length > 0) {
      tags.forEach(tag => {
        const span = d.createElement('span');
        span.style.cssText = 'font-size: 9px; background: rgba(140, 34, 48, 0.05); color: var(--forbidden-red); border: 1px solid rgba(140, 34, 48, 0.15); border-radius: 4px; padding: 1px 5px; font-weight: 500;';
        span.textContent = tag;
        summaryEl.appendChild(span);
      });
    } else {
      summaryEl.innerHTML = '<span style="font-size: 9px; color: var(--muted);">暂无命理标签，点击"档案"进行标记</span>';
    }
  }

  function loadProfile() {
    try {
      const profileStr = localStorage.getItem('shixing_profile');
      if (profileStr) {
        const p = JSON.parse(profileStr);
        if (p.gender) get('profileGender').value = p.gender;
        if (p.date) get('profileDate').value = p.date;
        if (p.time) get('profileTime').value = p.time;
        updateBazi();
        
        // Restore highlights
        safeSetTags('personality', p.personality);
        safeSetTags('psych', p.psych);
        safeSetTags('health', p.health);

        const textEl = get('profileBaziText');
        if (textEl) textEl.textContent = p.baziText || '已设定';
        renderProfileTagsSummary(p);
      } else {
        get('profileGender').value = '男';
        get('profileDate').value = '';
        get('profileTime').value = '';
        updateBazi();
        renderProfileTagsSummary({});
      }
      const savedKey = localStorage.getItem('shixing_api_key');
      if (savedKey) get('profileApiKey').value = savedKey;
      
      const keyBadge = get('insightKeyStatus');
      if (keyBadge) {
        if (savedKey) {
          keyBadge.textContent = '私钥已挂载';
          keyBadge.style.color = 'var(--forbidden-red)';
          keyBadge.style.borderColor = 'rgba(140, 34, 48, 0.3)';
          keyBadge.style.background = 'rgba(140, 34, 48, 0.04)';
        } else {
          keyBadge.textContent = '内置公钥';
          keyBadge.style.color = '#8a7f79';
          keyBadge.style.borderColor = 'rgba(138, 127, 121, 0.3)';
          keyBadge.style.background = 'transparent';
        }
      }
    } catch (e) {
      console.error("Error loading profile: ", e);
    }
  }

  async function fetchIpGeolocation() {
    try {
      const res = await fetch('https://r.inews.qq.com/api/ip2location');
      const data = await res.json();
      if (data && data.city) {
        const city = data.city;
        const province = data.province || '';
        
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
        const geoData = await geoRes.json();
        if (geoData && geoData.results && geoData.results.length > 0) {
          const loc = geoData.results[0];
          userGeo.latitude = loc.latitude;
          userGeo.longitude = loc.longitude;
          userGeo.city = city;
          userGeo.province = province;
          return true;
        }
      }
    } catch (e) {
      console.error("Tencent IP + geocode failed:", e);
    }
    
    try {
      const res = await fetch('https://ipapi.co/json/');
      const data = await res.json();
      if (data && data.latitude && data.longitude) {
        userGeo.latitude = data.latitude;
        userGeo.longitude = data.longitude;
        userGeo.city = data.city || '未知城市';
        userGeo.province = data.region || '';
        return true;
      }
    } catch (e) {
      console.error("IP geolocation backup failed:", e);
    }
    return false;
  }

  function cacheUserGeo(latitude, longitude, province, city) {
    userGeo.latitude = latitude;
    userGeo.longitude = longitude;
    userGeo.province = province;
    userGeo.city = city;
    try {
      localStorage.setItem('shixing_cached_geo', JSON.stringify({
        latitude, longitude, province, city,
        updatedAt: Date.now()
      }));
    } catch (e) {}
  }

  function runAutoGeolocation(force = false) {
    const badge = get('locationValue');
    if (!badge) return;

    const locMode = localStorage.getItem('shixing_location_mode') || 'auto';

    if (!force) {
      const cachedGeoStr = localStorage.getItem('shixing_cached_geo');
      if (cachedGeoStr) {
        try {
          const cached = JSON.parse(cachedGeoStr);
          const age = Date.now() - (cached.updatedAt || 0);
          if (locMode === 'manual' || age < 86400000) {
            userGeo.latitude = cached.latitude;
            userGeo.longitude = cached.longitude;
            userGeo.city = cached.city;
            userGeo.province = cached.province;
            badge.textContent = `📍 ${userGeo.province} ${userGeo.city}`;
            fetchWeather15Days();
            return;
          }
        } catch (e) {}
      } else if (locMode === 'manual') {
        userGeo.latitude = 39.9042;
        userGeo.longitude = 116.4074;
        userGeo.city = '北京市';
        userGeo.province = '北京市';
        badge.textContent = `📍 北京市 (默认)`;
        fetchWeather15Days();
        return;
      }
    }

    badge.textContent = `📍 正在定位...`;
    fetchIpGeolocation().then(success => {
      if (success) {
        badge.textContent = `📍 ${userGeo.province} ${userGeo.city}`;
        cacheUserGeo(userGeo.latitude, userGeo.longitude, userGeo.province, userGeo.city);
      } else {
        badge.textContent = `📍 北京市 (默认)`;
        cacheUserGeo(39.9042, 116.4074, '北京市', '北京市');
      }
      fetchWeather15Days();
    });
  }

  function initGeolocation() {
    runAutoGeolocation(false);
  }




  function initTaskModal() {
    const addTaskBtn = get('addTaskBtn');
    const taskModal = get('taskModal');
    const closeBtn = get('closeTaskModalBtn');
    const saveBtn = get('saveTaskBtn');
    
    if (!addTaskBtn || !taskModal || !closeBtn || !saveBtn) return;
    
    addTaskBtn.onclick = () => {
      get('taskTitleInput').value = '';
      get('taskTimeInput').value = '';
      get('taskTagSelect').value = '默认';
      get('taskImportantInput').checked = false;
      taskModal.style.display = 'flex';
    };
    
    closeBtn.onclick = () => {
      taskModal.style.display = 'none';
    };
    
    saveBtn.onclick = () => {
      const titleVal = get('taskTitleInput').value.trim();
      if (!titleVal) {
        alert('请填写纪实内容');
        return;
      }
      const timeVal = get('taskTimeInput').value;
      const tagVal = get('taskTagSelect').value;
      const importantVal = get('taskImportantInput').checked;
      
      const newTask = {
        date: ymd(selectedTaskDate || now),
        title: titleVal,
        time: timeVal || '全天',
        tag: tagVal,
        isImportant: importantVal,
        completed: false
      };
      
      tasks.push(newTask);
      localStorage.setItem('shixing_tasks', JSON.stringify(tasks));
      taskModal.style.display = 'none';
      
      renderTasks(selectedTaskDate || now);
      renderCalendar(currentYear, currentMonth);
    };
  }

  let draggedItem = null;
  let hasDragged = false;

  function restoreNavOrder() {
    const orderStr = localStorage.getItem('shixing_nav_order');
    if (!orderStr) return;
    try {
      const order = JSON.parse(orderStr);
      const navList = d.getElementById('navList');
      if (!navList) return;
      
      const cards = Array.from(navList.querySelectorAll('.nav-card'));
      const cardMap = {};
      cards.forEach(c => {
        const id = c.getAttribute('data-panel');
        if (id) cardMap[id] = c;
      });

      order.forEach(panelId => {
        const card = cardMap[panelId];
        if (card) {
          navList.appendChild(card);
          delete cardMap[panelId];
        }
      });
      Object.values(cardMap).forEach(card => {
        navList.appendChild(card);
      });
    } catch(e) {
      console.error("Failed to restore nav order:", e);
    }
  }

  function saveNavOrder() {
    const navList = d.getElementById('navList');
    if (!navList) return;
    const cards = navList.querySelectorAll('.nav-card');
    const order = Array.from(cards).map(card => card.getAttribute('data-panel')).filter(Boolean);
    localStorage.setItem('shixing_nav_order', JSON.stringify(order));
  }

  function initDragAndDrop() {
    const navList = d.getElementById('navList');
    if (!navList) return;
    const cards = navList.querySelectorAll('.nav-card');
    let lastSwapTime = 0;
    
    cards.forEach(card => {
      card.setAttribute('draggable', 'true');
      
      card.addEventListener('dragstart', (e) => {
        draggedItem = card;
        hasDragged = true;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.getAttribute('data-panel'));
      });
      
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        draggedItem = null;
        saveNavOrder();
        setTimeout(() => {
          hasDragged = false;
        }, 50);
      });
      
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedItem || draggedItem === card) return;
        
        const nowTime = Date.now();
        if (nowTime - lastSwapTime < 180) return; // Cooldown of 180ms for damping

        const rect = card.getBoundingClientRect();
        const mouseY = e.clientY;
        const targetCenterY = rect.top + rect.height / 2;
        
        // Jitter prevention
        if (draggedItem.nextSibling === card && mouseY < targetCenterY) return;
        if (card.nextSibling === draggedItem && mouseY > targetCenterY) return;

        lastSwapTime = nowTime;
        if (mouseY > targetCenterY) {
          navList.insertBefore(draggedItem, card.nextSibling);
        } else {
          navList.insertBefore(draggedItem, card);
        }
      });
    });
  }

  function init() {
    loadTasks();
    selectedTaskDate = now;
    loadProfile();
    initDailyStatus();
    restoreNavOrder();
    initDragAndDrop();
    renderCalendar(currentYear, currentMonth);
    initGeolocation();
    initTaskModal();
    updateDetailPanel(now);
    renderTasks(now);
    updateProfilePanelDisplay();
    updateLunarDetailCard(now);

    // 绑定导航栏面板切换
    d.querySelectorAll('.nav-card').forEach(card => {
      const panelId = card.getAttribute('data-panel');
      if (panelId) {
        card.onclick = () => {
          if (hasDragged) return;
          switchPanel(panelId);
        };
      }
    });

    // 绑定天气详情关闭
    const closeWeatherBtn = get('closeWeatherOverlayBtn');
    if (closeWeatherBtn) {
      closeWeatherBtn.onclick = () => {
        const overlay = get('hourlyWeatherOverlay');
        if (overlay) overlay.style.display = 'none';
      };
    }

    // 日历翻页
    prevBtn.onclick = () => { 
      currentMonth--; 
      if (currentMonth < 0) { currentMonth = 11; currentYear--; } 
      const midSolar = Solar.fromYmd(currentYear, currentMonth + 1, 15);
      const midLunar = midSolar.getLunar();
      currentLunarYear = midLunar.getYear();
      currentLunarMonth = midLunar.getMonth();

      // 同步移动 selectedTaskDate 至新月份的同一天或最后一天
      let targetDay = selectedTaskDate ? selectedTaskDate.getDate() : 1;
      const maxDays = new Date(currentYear, currentMonth + 1, 0).getDate();
      if (targetDay > maxDays) targetDay = maxDays;
      selectedTaskDate = new Date(currentYear, currentMonth, targetDay);

      renderCalendar(currentYear, currentMonth); 
      updateLunarDetailCard(selectedTaskDate);
      renderTasks(selectedTaskDate);
      updateDetailPanel(selectedTaskDate);
      loadDailyStatusForSelectedDate();
    };

    nextBtn.onclick = () => { 
      currentMonth++; 
      if (currentMonth > 11) { currentMonth = 0; currentYear++; } 
      const midSolar = Solar.fromYmd(currentYear, currentMonth + 1, 15);
      const midLunar = midSolar.getLunar();
      currentLunarYear = midLunar.getYear();
      currentLunarMonth = midLunar.getMonth();

      // 同步移动 selectedTaskDate 至新月份 the same day or max day
      let targetDay = selectedTaskDate ? selectedTaskDate.getDate() : 1;
      const maxDays = new Date(currentYear, currentMonth + 1, 0).getDate();
      if (targetDay > maxDays) targetDay = maxDays;
      selectedTaskDate = new Date(currentYear, currentMonth, targetDay);

      renderCalendar(currentYear, currentMonth); 
      updateLunarDetailCard(selectedTaskDate);
      renderTasks(selectedTaskDate);
      updateDetailPanel(selectedTaskDate);
      loadDailyStatusForSelectedDate();
    };

    todayBtn.onclick = () => { 
      currentYear = now.getFullYear(); 
      currentMonth = now.getMonth(); 
      selectedTaskDate = now; 
      const todayLunar = Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunar();
      currentLunarYear = todayLunar.getYear();
      currentLunarMonth = todayLunar.getMonth();

      renderCalendar(currentYear, currentMonth); 
      updateDetailPanel(now); 
      renderTasks(now); 
      loadDailyStatusForSelectedDate();
      updateLunarDetailCard(now);
      if (activePanelId !== 'calendar') {
        refreshActivePanel();
      }
    };

    // ==========================================
    // 系统设置组件 - 统一绑定
    // ==========================================
    function openSettings(tabName) {
      const overlay = get('settingsOverlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      switchSettingsTab(tabName || 'profile');
      if (tabName === 'profile') updateBazi();
      updateLocationStatusCard();
    }

    function switchSettingsTab(tabName) {
      d.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
      });
      d.querySelectorAll('.settings-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      const targetPane = tabName === 'profile' ? get('settingsPaneProfile') :
                         tabName === 'location' ? get('settingsPaneLocation') :
                         tabName === 'api' ? get('settingsPaneApi') : null;
      if (targetPane) targetPane.classList.add('active');
    }

    function updateLocationStatusCard() {
      const cityEl = get('statusCityText');
      const coordsEl = get('statusCoordsText');
      const timeEl = get('statusTimeText');
      if (cityEl) cityEl.textContent = `${userGeo.province} ${userGeo.city}`.trim() || '未知';
      if (coordsEl) coordsEl.textContent = `${userGeo.latitude.toFixed(4)}, ${userGeo.longitude.toFixed(4)}`;
      if (timeEl) {
        const cached = localStorage.getItem('shixing_cached_geo');
        if (cached) {
          try {
            const ts = JSON.parse(cached).updatedAt;
            if (ts) {
              const d_ = new Date(ts);
              timeEl.textContent = `${d_.getFullYear()}-${d_.getMonth()+1}-${d_.getDate()} ${d_.getHours()}:${String(d_.getMinutes()).padStart(2,'0')}`;
            }
          } catch(e) {}
        }
      }
    }

    // Tab 点击切换
    d.querySelectorAll('.settings-tab').forEach(tab => {
      tab.onclick = () => switchSettingsTab(tab.getAttribute('data-tab'));
    });

    // 档案表单绑定
    get('profileDate').addEventListener('change', updateBazi);
    get('profileTime').addEventListener('change', updateBazi);

    // 打开设置入口绑定
    get('openProfileBtn').onclick = () => openSettings('profile');
    get('closeSettingsBtn').onclick = () => { get('settingsOverlay').style.display = 'none'; };
    get('openSettingsBtn').onclick = () => openSettings('profile');

    // 页脚定位文本 - 点击打开定位设置
    const locBadge = get('locationValue');
    if (locBadge) {
      locBadge.style.cursor = 'pointer';
      locBadge.onclick = () => openSettings('location');
    }

    // 定位模式切换
    const modeAutoBtn = get('modeAutoBtn');
    const modeManualBtn = get('modeManualBtn');
    const manualGroup = get('manualLocationGroup');
    const savedLocMode = localStorage.getItem('shixing_location_mode') || 'auto';

    if (savedLocMode === 'manual') {
      if (modeAutoBtn) modeAutoBtn.classList.remove('active');
      if (modeManualBtn) modeManualBtn.classList.add('active');
      if (manualGroup) manualGroup.style.display = 'block';
    }

    if (modeAutoBtn) {
      modeAutoBtn.onclick = () => {
        modeAutoBtn.classList.add('active');
        modeManualBtn.classList.remove('active');
        if (manualGroup) manualGroup.style.display = 'none';
        localStorage.setItem('shixing_location_mode', 'auto');
      };
    }
    if (modeManualBtn) {
      modeManualBtn.onclick = () => {
        modeManualBtn.classList.add('active');
        modeAutoBtn.classList.remove('active');
        if (manualGroup) manualGroup.style.display = 'block';
        localStorage.setItem('shixing_location_mode', 'manual');
      };
    }

    // 手动城市查询
    const queryLocBtn = get('queryLocationBtn');
    if (queryLocBtn) {
      queryLocBtn.onclick = async () => {
        const cityInput = get('manualCityInput');
        const cityName = cityInput ? cityInput.value.trim() : '';
        if (!cityName) return;

        queryLocBtn.disabled = true;
        queryLocBtn.textContent = '查询中...';
        try {
          const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=zh`);
          const data = await res.json();
          if (data && data.results && data.results.length > 0) {
            const result = data.results[0];
            cacheUserGeo(result.latitude, result.longitude, result.admin1 || '', result.name || cityName);
            const badge_ = get('locationValue');
            if (badge_) badge_.textContent = `📍 ${userGeo.province} ${userGeo.city}`;
            updateLocationStatusCard();
            fetchWeather15Days();
          } else {
            const cityEl = get('statusCityText');
            if (cityEl) cityEl.textContent = `未找到"${cityName}"`;
          }
        } catch (e) {
          console.error('Geocoding failed:', e);
          const cityEl = get('statusCityText');
          if (cityEl) cityEl.textContent = '网络请求失败';
        }
        queryLocBtn.disabled = false;
        queryLocBtn.textContent = '查询';
      };
    }

    // 重新探测定位
    const forceRelocBtn = get('forceRelocateBtn');
    if (forceRelocBtn) {
      forceRelocBtn.onclick = () => {
        localStorage.removeItem('shixing_cached_geo');
        localStorage.setItem('shixing_location_mode', 'auto');
        if (modeAutoBtn) modeAutoBtn.classList.add('active');
        if (modeManualBtn) modeManualBtn.classList.remove('active');
        if (manualGroup) manualGroup.style.display = 'none';
        runAutoGeolocation(true);
        setTimeout(updateLocationStatusCard, 3000);
      };
    }

    // API 密钥可见性切换
    const toggleKeyBtn = get('toggleApiKeyVisibleBtn');
    if (toggleKeyBtn) {
      toggleKeyBtn.onclick = () => {
        const keyInput = get('profileApiKey');
        if (!keyInput) return;
        if (keyInput.type === 'password') {
          keyInput.type = 'text';
          toggleKeyBtn.textContent = '🙈';
        } else {
          keyInput.type = 'password';
          toggleKeyBtn.textContent = '👁️';
        }
      };
    }

    // 加载已保存的 API Host
    const savedApiHost = localStorage.getItem('shixing_api_host');
    const apiHostInput = get('profileApiHost');
    if (savedApiHost && apiHostInput) apiHostInput.value = savedApiHost;

    // 测试连接
    const testApiBtn = get('testApiBtn');
    if (testApiBtn) {
      testApiBtn.onclick = async () => {
        const resultEl = get('apiTestResult');
        if (!resultEl) return;
        resultEl.style.display = 'block';
        resultEl.className = 'api-test-loading';
        resultEl.textContent = '⏳ 正在连接…';
        testApiBtn.disabled = true;

        const apiKey = get('profileApiKey') ? get('profileApiKey').value.trim() : '';
        const apiHost = get('profileApiHost') ? get('profileApiHost').value.trim() : '';
        const baseUrl = apiHost || INSIGHT_CONFIG.API_URL.replace('/chat/completions', '');
        const testUrl = baseUrl.replace(/\/+$/, '') + '/models';

        try {
          const headers = { 'Content-Type': 'application/json' };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          const res = await fetch(testUrl, { method: 'GET', headers });
          if (res.ok) {
            resultEl.className = 'api-test-success';
            resultEl.textContent = '✅ 连接成功！服务可用。';
          } else {
            resultEl.className = 'api-test-error';
            resultEl.textContent = `❌ 连接失败（HTTP ${res.status}）`;
          }
        } catch (e) {
          resultEl.className = 'api-test-error';
          resultEl.textContent = `❌ 连接失败：${e.message || '网络错误'}`;
        }
        testApiBtn.disabled = false;
      };
    }

    // 统一保存设置
    get('saveSettingsBtn').onclick = () => {
      const dateVal = get('profileDate').value;
      const timeVal = get('profileTime').value;
      let hasProfile = false;
      let pTemp = {};

      // 1. 保存个人档案
      if (dateVal && timeVal) {
        const baziResEl = get('profileBaziResult');
        const chars = baziResEl.querySelectorAll('.bz-char');
        const baziTextVal = chars.length >= 6 ? `命主：${chars[4].textContent}${chars[5].textContent}日` : '已设定';
        
        pTemp = {
          gender: get('profileGender').value,
          date: dateVal,
          time: timeVal,
          bazi: baziResEl.innerHTML,
          baziText: baziTextVal,
          personality: safeGetTags('personality'),
          psych: safeGetTags('psych'),
          health: safeGetTags('health')
        };
        localStorage.setItem('shixing_profile', JSON.stringify(pTemp));
        hasProfile = true;
      } else {
        localStorage.removeItem('shixing_profile');
      }
      
      // 2. 保存 API Key
      const keyVal = get('profileApiKey').value.trim();
      if (keyVal) {
        localStorage.setItem('shixing_api_key', keyVal);
      } else {
        localStorage.removeItem('shixing_api_key');
      }

      // 3. 保存 API Host
      const hostVal = get('profileApiHost') ? get('profileApiHost').value.trim() : '';
      if (hostVal) {
        localStorage.setItem('shixing_api_host', hostVal);
      } else {
        localStorage.removeItem('shixing_api_host');
      }
      
      // 4. 更新界面
      const textEl = get('profileBaziText');
      if (textEl) textEl.textContent = hasProfile ? pTemp.baziText : '未设定';
      renderProfileTagsSummary(hasProfile ? pTemp : {});
      updateProfilePanelDisplay();
      
      // 5. 更新密钥状态标记
      const keyBadge = get('insightKeyStatus');
      if (keyBadge) {
        if (keyVal) {
          keyBadge.textContent = '私钥已挂载';
          keyBadge.style.color = 'var(--forbidden-red)';
          keyBadge.style.borderColor = 'rgba(140, 34, 48, 0.3)';
          keyBadge.style.background = 'rgba(140, 34, 48, 0.04)';
        } else {
          keyBadge.textContent = '内置公钥';
          keyBadge.style.color = '#8a7f79';
          keyBadge.style.borderColor = 'rgba(138, 127, 121, 0.3)';
          keyBadge.style.background = 'transparent';
        }
      }

      get('settingsOverlay').style.display = 'none';
    };

    // 舞台漫游拖拽引擎
    let isDraggingStage = false, startX, initialScrollLeft;
    stageBody.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tarot-card-wrapper')) return;
      isDraggingStage = true; stageBody.style.cursor = 'grabbing'; stageBody.style.userSelect = 'none';
      startX = e.pageX - stageBody.offsetLeft; initialScrollLeft = stageBody.scrollLeft;
    });
    window.addEventListener('mouseup', () => { isDraggingStage = false; stageBody.style.cursor = 'grab'; stageBody.style.userSelect = ''; });
    window.addEventListener('mousemove', (e) => {
      if (!isDraggingStage) return; e.preventDefault();
      stageBody.scrollLeft = initialScrollLeft - (e.pageX - stageBody.offsetLeft - startX) * 1.5;
    });

    const closeStageBtn = get('closeStageBtn');
    if (closeStageBtn) {
      closeStageBtn.onclick = () => { 
        if (insightStageOverlay) insightStageOverlay.style.display = 'none'; 
        d.body.style.overflow = ''; 
        isRoundMode = false; 
        isAiLoading = false; 
        stageBody.innerHTML = ''; 
      };
    }
    
    const roundBtn = get('insightRoundBtn');
    if (roundBtn) roundBtn.onclick = () => {
      if (!dailyTarotData) return;
      isRoundMode = !isRoundMode;
      roundBtn.textContent = isRoundMode ? "一键：展开长轴" : "一键：绕线成钟";
      renderInsightStage(dailyTarotData, isRoundMode ? 'round' : 'linear');
    };

    if (insightPanel) {
      insightPanel.onclick = () => { if (!isAiLoading && selectedTaskDate) openInsightStage(selectedTaskDate); };
    }

    // 绑定右侧聊天对话框交互
    const sendBtn = get('sendChatBtn');
    const chatInput = get('chatInput');
    const chatMessages = get('chatMessages');
    const clearChatBtn = get('clearChatBtn');
    
    if (sendBtn && chatInput && chatMessages) {
      const appendMessage = (sender, text, isUser = false) => {
        const msgDiv = d.createElement('div');
        msgDiv.className = `chat-message ${isUser ? 'user' : 'system'}`;
        msgDiv.innerHTML = `
          <div class="chat-msg-meta">
            <span>👤 ${sender}</span>
            <span>刚刚</span>
          </div>
          <div class="msg-bubble">
            ${text}
          </div>
        `;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      };

      const handleSend = async () => {
        const text = chatInput.value.trim();
        if (!text) return;
        
        appendMessage('我', text, true);
        chatInput.value = '';
        
        // Disable input while loading
        chatInput.disabled = true;
        sendBtn.disabled = true;
                // Add temporary typing indicator
        const typingId = 'typing-' + Date.now();
        const typingDiv = d.createElement('div');
        typingDiv.id = typingId;
        typingDiv.className = 'chat-message system';
        typingDiv.innerHTML = `
          <div class="chat-msg-meta">
            <span>👤 AI 助手</span>
            <span>正在思考...</span>
          </div>
          <div class="msg-bubble">
            ⏳ 正在思考并推演...
          </div>
        `;
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
          const messages = [];
          const dateContext = buildInsightContext(selectedTaskDate || now);
          
          messages.push({
            role: 'system',
            content: `你是一个集成在《时行》个人决策系统中的智能 AI 助手。你的名字叫“AI 助手”。
你的职责是协助用户，解答疑问。你可以结合用户在系统内当前的【天时】、【地利】、【人和】以及【个人档案】（如果相关的话）为其提供中肯、贴心且实用的建议。
请使用友好、专业、得体、现代的中文语言与用户交流。不要总是生硬地搬出八字或命理术语，除非用户主动问及。回答应言简意赅，重点突出。

当前用户的背景上下文如下：
${dateContext}`
          });
          
          // Add history
          chatHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
          });
          
          // Add current message
          messages.push({ role: 'user', content: text });
          
          const reply = await fetchDeepSeekChat(messages);
          
          // Remove typing indicator
          const tEl = get(typingId);
          if (tEl) tEl.remove();
          
          appendMessage('AI 助手', reply, false);
          
          chatHistory.push({ role: 'user', content: text });
          chatHistory.push({ role: 'assistant', content: reply });
        } catch (err) {
          console.error("AI chat failed:", err);
          const tEl = get(typingId);
          if (tEl) tEl.remove();
          appendMessage('AI 助手', `❌ 获取回复失败：${err.message || '网络连接异常，请检查设置。'}`, false);
        } finally {
          chatInput.disabled = false;
          sendBtn.disabled = false;
          chatInput.focus();
        }
      };

      sendBtn.onclick = handleSend;
      chatInput.onkeydown = (e) => { if (e.key === 'Enter') handleSend(); };
      
      if (clearChatBtn) {
        clearChatBtn.onclick = () => {
          chatHistory = [];
          chatMessages.innerHTML = `
            <div class="chat-message system">
              <div class="chat-msg-meta">
                <span>👤 AI 助手</span>
                <span>刚刚</span>
              </div>
              <div class="msg-bubble">
                对话已清空，您可以重新开始提问。
              </div>
            </div>
          `;
        };
      }
    }
  }

  // 启动时行 OS
  init();
})();
