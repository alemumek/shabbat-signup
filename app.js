// הגדרות קונפיגורציה
const BACKEND_URL = 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL'; // יש להחליף ב-URL של ה-Web App

// ניהול State
let registrationsCache = [];
let detectedEventName = '';

// אתחול
document.addEventListener('DOMContentLoaded', () => {
  initFormConstraints();
  setupEventListeners();
  loadRegistrations();
});

// הגבלת תאריך מינימלי להיום
function initFormConstraints() {
  const dateInput = document.getElementById('date');
  const today = formatLocalYYYYMMDD(new Date());
  dateInput.setAttribute('min', today);
}

// האזנה לאירועים
function setupEventListeners() {
  const dateInput = document.getElementById('date');
  dateInput.addEventListener('change', validateDateInput);
  dateInput.addEventListener('input', validateDateInput);

  const signupForm = document.getElementById('signupForm');
  signupForm.addEventListener('submit', handleSubmit);
}

// המרת תאריך לפורמט YYYY-MM-DD מקומי (מניעת הסטת UTC)
function formatLocalYYYYMMDD(dateInput) {
  const d = new Date(dateInput);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// בדיקת יום חג מול Hebcal REST API
async function fetchHolidayName(dateStr) {
  try {
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&i=on&start=${dateStr}&end=${dateStr}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const holidayItem = data.items && data.items.find(item => item.category === 'holiday');
    return holidayItem ? holidayItem.hebrew : null;
  } catch (error) {
    console.error('Error fetching holiday:', error);
    return null;
  }
}

// אימות תאריך (שישי/שבת או חג)
async function validateDateInput() {
  const dateInput = document.getElementById('date');
  const dateError = document.getElementById('dateError');
  const selectedDateStr = dateInput.value;

  if (!selectedDateStr) {
    dateError.style.display = 'none';
    detectedEventName = '';
    return false;
  }

  const [year, month, day] = selectedDateStr.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day);
  const dayOfWeek = selectedDate.getDay(); // 5 = שישי, 6 = שבת
  const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);

  if (isWeekend) {
    detectedEventName = '';
    dateError.style.display = 'none';
    return true;
  }

  // חיווי טעינה בזמן בדיקה מול Hebcal
  dateError.textContent = 'בודק אם התאריך הוא יום חג...';
  dateError.style.color = '#7f8c8d';
  dateError.style.display = 'block';

  const holidayName = await fetchHolidayName(selectedDateStr);

  if (holidayName) {
    detectedEventName = holidayName;
    dateError.style.display = 'none';
    return true;
  } else {
    detectedEventName = '';
    dateError.textContent = 'ניתן לבחור ימי שישי, שבת או ימי חג בלבד.';
    dateError.style.color = '#e74c3c';
    dateError.style.display = 'block';
    return false;
  }
}

// טיפול בשליחת הטופס
async function handleSubmit(e) {
  e.preventDefault();

  const isValid = await validateDateInput();
  if (!isValid) return;

  const submitBtn = document.getElementById('submitBtn');
  const formStatus = document.getElementById('formStatus');
  const editId = document.getElementById('editId').value;
  const name = document.getElementById('name').value.trim();
  const date = document.getElementById('date').value;

  submitBtn.disabled = true;
  formStatus.textContent = 'שומר...';
  formStatus.style.color = '#3498db';
  document.getElementById('whatsappContainer').style.display = 'none';

  const action = editId ? 'update' : 'add';
  const payload = {
    action: action,
    id: editId,
    name: name,
    date: date,
    eventName: detectedEventName
  };

  try {
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.status === 'success') {
      formStatus.textContent = editId ? 'ההרשמה עודכנה בהצלחה!' : 'נרשמת בהצלחה!';
      formStatus.style.color = '#27ae60';

      setupWhatsAppShare(name, date, detectedEventName);
      resetFormInputs();
      await loadRegistrations();
    } else {
      throw new Error(result.message || 'שגיאה בשמירה');
    }
  } catch (error) {
    console.error('Submission error:', error);
    formStatus.textContent = 'שגיאה בחיבור לשרת. נסה שוב.';
    formStatus.style.color = '#e74c3c';
  } finally {
    submitBtn.disabled = false;
  }
}

// טעינת הרשמות מהשרת
async function loadRegistrations() {
  const futureList = document.getElementById('futureList');
  const historyList = document.getElementById('historyList');

  try {
    const response = await fetch(BACKEND_URL);
    const result = await response.json();

    if (result.status === 'success') {
      registrationsCache = result.data || [];
      renderRegistrations();
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Load error:', error);
    futureList.innerHTML = '<div class="empty-msg">שגיאה בטעינת נתונים.</div>';
    historyList.innerHTML = '<div class="empty-msg">שגיאה בטעינת נתונים.</div>';
  }
}

// רינדור הרשמות לפי בלשיות
function renderRegistrations() {
  const futureList = document.getElementById('futureList');
  const historyList = document.getElementById('historyList');

  futureList.innerHTML = '';
  historyList.innerHTML = '';

  const now = new Date();
  const futureItems = [];
  const historyItems = [];

  registrationsCache.forEach(item => {
    const [y, m, d] = item.date.split('-').map(Number);
    const eventEndDate = new Date(y, m - 1, d, 23, 59, 59);

    if (now <= eventEndDate) {
      futureItems.push(item);
    } else {
      historyItems.push(item);
    }
  });

  futureItems.sort((a, b) => new Date(a.date) - new Date(b.date));
  historyItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (futureItems.length === 0) {
    futureList.innerHTML = '<div class="empty-msg">אין הרשמות עתידיות.</div>';
  } else {
    futureItems.forEach(item => futureList.appendChild(createRegistrationCard(item, true)));
  }

  if (historyItems.length === 0) {
    historyList.innerHTML = '<div class="empty-msg">אין היסטוריית הרשמות.</div>';
  } else {
    historyItems.forEach(item => historyList.appendChild(createRegistrationCard(item, false)));
  }
}

// יצירת כרטיס הרשמה
function createRegistrationCard(item, isFuture) {
  const card = document.createElement('div');
  card.className = `reg-item ${isFuture ? '' : 'history-item'}`;

  const infoDiv = document.createElement('div');
  infoDiv.className = 'reg-info';

  const nameHead = document.createElement('h3');
  nameHead.textContent = item.name;

  const dateSpan = document.createElement('div');
  dateSpan.className = 'reg-date';
  dateSpan.textContent = formatCardDateDisplay(item.date, item.eventName);

  const tagContainer = document.createElement('div');
  tagContainer.id = `tag-${item.id}`;

  if (item.eventName) {
    tagContainer.innerHTML = `<span class="holiday-label">🍷 ${item.eventName}</span>`;
  } else {
    tagContainer.innerHTML = `<span class="parasha-label">טוען פרשה...</span>`;
    fetchParashaForSaturday(item.date, tagContainer);
  }

  infoDiv.appendChild(nameHead);
  infoDiv.appendChild(dateSpan);
  infoDiv.appendChild(tagContainer);
  card.appendChild(infoDiv);

  if (isFuture) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = 'עריכה';
    editBtn.onclick = () => setupEdit(item.id, item.name, item.date, item.eventName);
    card.appendChild(editBtn);
  }

  return card;
}

// שליפת פרשת השבוע עבור שבת
async function fetchParashaForSaturday(dateStr, containerElement) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dayOfWeek = dt.getDay();
    
    const saturdayDate = new Date(dt);
    if (dayOfWeek !== 6) {
      saturdayDate.setDate(dt.getDate() + (6 - dayOfWeek));
    }

    const satIso = formatLocalYYYYMMDD(saturdayDate);
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&start=${satIso}&end=${satIso}&s=on`;

    const response = await fetch(url);
    const data = await response.json();
    const parashaItem = data.items && data.items.find(i => i.category === 'parashat');

    if (parashaItem) {
      containerElement.innerHTML = `<span class="parasha-label">📖 ${parashaItem.hebrew}</span>`;
    } else {
      containerElement.innerHTML = `<span class="parasha-label">שבת</span>`;
    }
  } catch (error) {
    containerElement.innerHTML = `<span class="parasha-label">שבת</span>`;
  }
}

// פורמט תצוגת תאריכים בכרטיס
function formatCardDateDisplay(dateStr, eventName) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);

  if (eventName) {
    return `יום ${getHebrewDayName(dt.getDay())}, ${formatDateIL(dt)}`;
  } else {
    const friday = new Date(dt);
    if (dt.getDay() === 6) friday.setDate(dt.getDate() - 1);
    const saturday = new Date(friday);
    saturday.setDate(friday.getDate() + 1);

    return `שישי - שבת: ${formatDateIL(friday)} - ${formatDateIL(saturday)}`;
  }
}

function formatDateIL(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function getHebrewDayName(dayIndex) {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return days[dayIndex] || '';
}

// הגדרת מצב עריכה
function setupEdit(id, name, date, eventName) {
  document.getElementById('editId').value = id;
  document.getElementById('name').value = name;
  document.getElementById('date').value = formatLocalYYYYMMDD(date);
  detectedEventName = eventName || '';

  const formCard = document.getElementById('formCard');
  formCard.classList.add('editing-mode');

  document.getElementById('editBanner').style.display = 'block';
  document.getElementById('submitBtn').textContent = 'עדכן הרשמה';
  document.getElementById('cancelBtn').style.display = 'block';

  switchTab('future');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ביטול עריכה
function cancelEdit() {
  resetFormInputs();
  document.getElementById('whatsappContainer').style.display = 'none';
}

// איפוס שדות הטופס
function resetFormInputs() {
  document.getElementById('editId').value = '';
  document.getElementById('name').value = '';
  document.getElementById('date').value = '';
  document.getElementById('dateError').style.display = 'none';

  const formCard = document.getElementById('formCard');
  formCard.classList.remove('editing-mode');

  document.getElementById('editBanner').style.display = 'none';
  document.getElementById('submitBtn').textContent = 'אישור הרשמה';
  document.getElementById('cancelBtn').style.display = 'none';
  document.getElementById('formStatus').textContent = '';

  detectedEventName = '';
}

// מעבר בלשיות
function switchTab(tabId) {
  const tabFuture = document.getElementById('tabFuture');
  const tabHistory = document.getElementById('tabHistory');
  const futureView = document.getElementById('futureView');
  const historyView = document.getElementById('historyView');

  if (tabId === 'future') {
    tabFuture.classList.add('active');
    tabHistory.classList.remove('active');
    futureView.style.display = 'block';
    historyView.style.display = 'none';
  } else {
    tabHistory.classList.add('active');
    tabFuture.classList.remove('active');
    historyView.style.display = 'block';
    futureView.style.display = 'none';
  }
}

// הכנת קישור שיתוף ב-WhatsApp
function setupWhatsAppShare(name, dateStr, eventName) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);

  let dateDetail = '';
  if (eventName) {
    dateDetail = `🍷 חג: ${eventName} (יום ${getHebrewDayName(dt.getDay())}, ${formatDateIL(dt)})`;
  } else {
    const friday = new Date(dt);
    if (dt.getDay() === 6) friday.setDate(dt.getDate() - 1);
    const saturday = new Date(friday);
    saturday.setDate(friday.getDate() + 1);

    const fDay = String(friday.getDate()).padStart(2, '0');
    const sDay = String(saturday.getDate()).padStart(2, '0');
    const month = String(friday.getMonth() + 1).padStart(2, '0');
    const year = friday.getFullYear();

    dateDetail = `📅 סופ״ש: ${fDay}-${sDay}/${month}/${year}`;
  }

  const appUrl = window.location.href.split('#')[0];

  const message = 
`מה נשמע שבט מקונן? 😎
לידיעתכם📯
רשימת שבת/חג אצל ההורים התעדכנה📝

👨‍👩‍👧‍👦 משפחה: ${name}
${dateDetail}

🔗 לצפייה והרשמה: ${appUrl}
המשך יום נפלא! 😀`;

  const encodedMessage = encodeURIComponent(message);
  const shareBtn = document.getElementById('whatsappShareBtn');
  shareBtn.href = `https://api.whatsapp.com/send?text=${encodedMessage}`;

  document.getElementById('whatsappContainer').style.display = 'block';
}
