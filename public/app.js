const modal = document.getElementById("loginModal");
const loginError = document.getElementById("loginError");
const chatBody = document.getElementById("chatBody");
const askForm = document.getElementById("askForm");
const questionInput = document.getElementById("questionInput");
const askBtn = document.getElementById("askBtn");
let accessCode = localStorage.getItem("hexSchoolCode") || "";

function openLogin(){ modal.classList.add("show"); modal.setAttribute("aria-hidden","false"); }
function closeLogin(){ modal.classList.remove("show"); modal.setAttribute("aria-hidden","true"); }
document.getElementById("startBtn").addEventListener("click", () => accessCode ? document.getElementById("assistant").scrollIntoView({behavior:"smooth"}) : openLogin());
document.getElementById("headerLogin").addEventListener("click", openLogin);
document.getElementById("closeModal").addEventListener("click", closeLogin);
modal.addEventListener("click", e => { if(e.target === modal) closeLogin(); });

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  loginError.textContent = "";
  const code = document.getElementById("accessCode").value.trim();
  try {
    const response = await fetch("/api/login", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "تعذر تسجيل الدخول");
    accessCode = code;
    localStorage.setItem("hexSchoolCode", code);
    closeLogin();
    document.getElementById("assistant").scrollIntoView({behavior:"smooth"});
    showToast("أهلاً بك! يمكنك الآن طرح سؤالك.");
  } catch(err) { loginError.textContent = err.message; }
});

function addMessage(text, type){
  const node = document.createElement("div");
  node.className = `message ${type === "user" ? "user-message" : "bot-message"}`;
  node.textContent = text;
  chatBody.appendChild(node);
  chatBody.scrollTop = chatBody.scrollHeight;
}
function showToast(text){
  const toast = document.getElementById("toast");
  toast.textContent = text; toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}
askForm.addEventListener("submit", async e => {
  e.preventDefault();
  const question = questionInput.value.trim();
  if(!question) return;
  if(!accessCode){ openLogin(); showToast("سجّل الدخول بكود المدرسة أولاً."); return; }
  addMessage(question, "user");
  questionInput.value = "";
  askBtn.disabled = true;
  const waiting = document.createElement("div");
  waiting.className = "message bot-message"; waiting.textContent = "HEX يفكر في سؤالك…"; chatBody.appendChild(waiting);
  try {
    const response = await fetch("/api/ask", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question,code:accessCode})});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "حدث خطأ");
    waiting.textContent = data.answer;
    if(data.source === "cache") showToast("تم استخدام إجابة محفوظة لتوفير استدعاء API.");
  } catch(err) {
    waiting.textContent = err.message;
    if(responseUnauthorized(err)) { accessCode = ""; localStorage.removeItem("hexSchoolCode"); }
  } finally { askBtn.disabled = false; questionInput.focus(); chatBody.scrollTop = chatBody.scrollHeight; }
});
function responseUnauthorized(_err){ return false; }


// ===== HEX LEARN: IMAGE QUESTION SOLVER =====
const questionImage = document.getElementById("questionImage");
const chooseImageBtn = document.getElementById("chooseImageBtn");
const imageFileName = document.getElementById("imageFileName");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imagePreview = document.getElementById("imagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const solveImageBtn = document.getElementById("solveImageBtn");
const imageStatus = document.getElementById("imageStatus");

let selectedQuestionImage = null;
let imagePreviewUrl = null;

if (
  questionImage &&
  chooseImageBtn &&
  imagePreviewWrap &&
  imagePreview &&
  removeImageBtn &&
  solveImageBtn &&
  imageStatus
) {
  chooseImageBtn.addEventListener("click", () => {
    questionImage.click();
  });

  questionImage.addEventListener("change", () => {
    const file = questionImage.files?.[0];

    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
      showToast("اختر صورة JPG أو PNG أو WEBP فقط.");
      questionImage.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("حجم الصورة يجب ألا يتجاوز 5 ميجابايت.");
      questionImage.value = "";
      return;
    }

    selectedQuestionImage = file;

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    imagePreviewUrl = URL.createObjectURL(file);
    imagePreview.src = imagePreviewUrl;
    imagePreviewWrap.hidden = false;
    imageFileName.textContent = file.name;
    imageStatus.textContent = "الصورة جاهزة للتحليل.";
    solveImageBtn.disabled = false;
  });

  removeImageBtn.addEventListener("click", () => {
    selectedQuestionImage = null;
    questionImage.value = "";
    imagePreview.removeAttribute("src");
    imagePreviewWrap.hidden = true;
    imageFileName.textContent = "لم يتم اختيار صورة";
    imageStatus.textContent = "";
    solveImageBtn.disabled = true;

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
  });

  solveImageBtn.addEventListener("click", async () => {
    if (!selectedQuestionImage) {
      showToast("اختر صورة السؤال أولاً.");
      return;
    }

    if (!accessCode) {
      openLogin();
      showToast("سجّل الدخول بكود المدرسة أولاً.");
      return;
    }

    const file = selectedQuestionImage;

    solveImageBtn.disabled = true;
    chooseImageBtn.disabled = true;
    imageStatus.textContent = "جارٍ تحليل الصورة وقراءة السؤال...";

    addMessage("📷 صورة السؤال: " + file.name, "user");

    const waiting = document.createElement("div");
    waiting.className = "message bot-message";
    waiting.textContent = "HEX يقرأ الصورة ويحل السؤال... انتظر قليلاً.";
    chatBody.appendChild(waiting);
    chatBody.scrollTop = chatBody.scrollHeight;

    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");

          if (comma === -1) {
            reject(new Error("تعذرت قراءة الصورة."));
            return;
          }

          resolve(result.slice(comma + 1));
        };

        reader.onerror = () => reject(new Error("حدث خطأ أثناء قراءة الصورة."));
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/ask-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: accessCode,
          mimeType: file.type,
          imageData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "تعذر تحليل الصورة.");
      }

      waiting.textContent = data.answer || "لم يتم العثور على إجابة.";

      if (data.source === "image-cache") {
        showToast("تم استخدام حل الصورة المحفوظ لتوفير API.");
      } else {
        showToast("تم تحليل الصورة بنجاح.");
      }

      imageStatus.textContent = "انتهى تحليل الصورة بنجاح.";

    } catch (err) {
      waiting.textContent = err.message || "حدث خطأ أثناء تحليل الصورة.";
      imageStatus.textContent = "تعذر تحليل الصورة.";
    } finally {
      solveImageBtn.disabled = !selectedQuestionImage;
      chooseImageBtn.disabled = false;
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  });
}
// ===== END IMAGE QUESTION SOLVER =====
