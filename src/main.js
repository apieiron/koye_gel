import './style.css'
import citiesData from './data/cities.json'
import { auth, db } from './firebase-config.js'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification
} from 'firebase/auth'
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot
} from 'firebase/firestore'

// Simple SPA Router
const app = document.getElementById('app')

// Firebase Reactive State
let currentUser = null;
let dbListings = [];
let dbApplications = [];
let dbNotifications = [];
let dbFeedbacks = [];

let unsubListings = null;
let unsubApplications = null;
let unsubNotifications = null;
let unsubFeedbacks = null;

function setupRealtimeListeners() {
  stopRealtimeListeners();

  // 1. Listen to listings
  unsubListings = onSnapshot(collection(db, 'listings'), (snapshot) => {
    dbListings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Seed default listings if Firestore is empty
    if (dbListings.length === 0) {
      seedDefaultListings();
    }
    
    // Rerender active view
    triggerRerender();
  });

  // 2. Listen to feedbacks
  unsubFeedbacks = onSnapshot(collection(db, 'feedbacks'), (snapshot) => {
    dbFeedbacks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort by date (descending) if we have timestamp
    dbFeedbacks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    triggerRerender();
  });

  // 3. Listen to applications
  unsubApplications = onSnapshot(collection(db, 'applications'), (snapshot) => {
    dbApplications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    triggerRerender();
  });

  // 4. Listen to notifications (for current user only)
  if (currentUser) {
    const notifQuery = query(
      collection(db, 'notifications'), 
      where('userId', '==', currentUser.uid)
    );
    unsubNotifications = onSnapshot(notifQuery, (snapshot) => {
      dbNotifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      dbNotifications.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      const badge = document.getElementById('notification-badge');
      const unreadCount = dbNotifications.filter(n => !n.isRead).length;
      if (badge) {
        if (unreadCount > 0) {
          badge.style.display = 'block';
          badge.textContent = unreadCount;
        } else {
          badge.style.display = 'none';
        }
      }
    });
  }
}

function stopRealtimeListeners() {
  if (unsubListings) { unsubListings(); unsubListings = null; }
  if (unsubFeedbacks) { unsubFeedbacks(); unsubFeedbacks = null; }
  if (unsubApplications) { unsubApplications(); unsubApplications = null; }
  if (unsubNotifications) { unsubNotifications(); unsubNotifications = null; }
}

function triggerRerender() {
  const path = window.location.pathname;
  if (path === '/dashboard') renderDashboard(app);
  else if (path === '/my-listings') renderMyListings(app);
  else if (path === '/applications') renderApplications(app);
  else if (path === '/admin') renderAdminDashboard(app);
}

async function seedDefaultListings() {
  const defaultListings = [
    {
      ownerId: 'other_user_id',
      ownerEmail: 'evsahibi@gmail.com',
      isActive: true,
      type: 'owner',
      typeLabel: 'Ev Sahibi',
      time: '2 saat önce',
      location: 'Edirne / Enez / Sultaniçe',
      duration: 'Yaz Sezonluk',
      housing: 'Ev İçinde Ayrı Oda',
      desc: 'Yaz sezonu boyunca bahçe işlerinde ve zeytin hasadında yardımcı olacak arkadaşlar arıyoruz. Ayrıca yaşlı anneme yoldaşlık yapılması sevindirir. Evimizin bir odası ve yemekler bizden.',
      skills: ['🌱 Bahçe Bakımı', '👵 Yaşlı Bakımı', '🏠 Ücretsiz Konaklama'],
      actionLabel: 'Başvur',
      color: 'var(--primary)',
      createdAt: new Date().getTime()
    },
    {
      ownerId: 'other_visitor_id',
      ownerEmail: 'gezgin@gmail.com',
      isActive: true,
      type: 'visitor',
      typeLabel: 'Gezgin / İş Arayan',
      time: '1 gün önce',
      location: 'Tüm Türkiye (Öncelik Ege)',
      duration: 'Uzun Süreli / Kalıcı',
      housing: '-',
      desc: 'Eşimle birlikte köy hayatını deneyimlemek istiyoruz. İnşaat ve tamirat işlerinden anlarım, eşim mutfak işlerinde ve genel ev temizliğinde destek olabilir.',
      skills: ['🔨 Tamirat', '🍲 Ev İşleri & Yemek'],
      actionLabel: 'İlanına Çağır',
      color: 'var(--accent)',
      createdAt: new Date().getTime() - 86400000
    }
  ];
  
  for (const item of defaultListings) {
    try {
      await addDoc(collection(db, 'listings'), item);
    } catch (e) {
      console.error("Error seeding listings: ", e);
    }
  }
}

// Auth State Monitor
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  stopRealtimeListeners();
  
  if (user) {
    window.currentUserEmail = user.email;
    
    if (user.email === 'apieiron@gmail.com') {
      // Admin verification: must be logged in with Google provider
      const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
      if (!isGoogle) {
        await signOut(auth);
        window.showCustomAlert('Erişim Engellendi', 'Yönetici hesabı için sadece Google ile Giriş yöntemine izin verilmektedir.', 'error');
        navigate('/');
        return;
      }

      document.getElementById('nav-login').style.display = 'inline-flex';
      document.getElementById('nav-login').textContent = 'Çıkış Yap';
      document.getElementById('profile-dropdown-container').style.display = 'none';
      document.getElementById('nav-notifications').style.display = 'none';
      
      setupRealtimeListeners();
      
      if (window.location.pathname === '/' || window.location.pathname === '/roles') {
        navigate('/admin');
      }
    } else {
      // Email Verification check for password login
      const isGoogleUser = user.providerData.some(p => p.providerId === 'google.com');
      const isEmailVerified = user.emailVerified || isGoogleUser;

      if (!isEmailVerified) {
        document.getElementById('nav-login').style.display = 'inline-flex';
        document.getElementById('nav-login').textContent = 'Çıkış Yap';
        document.getElementById('profile-dropdown-container').style.display = 'none';
        document.getElementById('nav-notifications').style.display = 'none';
        navigate('/verify-email');
        return;
      }

      // Fetch user profile from Firestore
      // Fetch user profile from Firestore
      let userDocExists = false;
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          window.userProfile = userDoc.data();
          userDocExists = true;
        } else {
          window.userProfile = null;
        }
      } catch (err) {
        console.error("Error fetching user profile:", err);
        window.userProfile = null;
      }

      // Check KVKK status for new users
      if (!userDocExists) {
        const kvkkChecked = document.getElementById('kvkk') && document.getElementById('kvkk').checked;
        if (!kvkkChecked) {
          await signOut(auth);
          window.showCustomAlert('KVKK Onayı Gerekli', 'Yeni hesap oluşturmak için lütfen KVKK Aydınlatma Metni\'ni okuyup onaylayınız.', 'error');
          navigate('/');
          return;
        } else {
          // Initialize user profile doc with KVKK status
          try {
            await setDoc(doc(db, 'users', user.uid), { kvkkAccepted: true, email: user.email }, { merge: true });
            window.userProfile = { kvkkAccepted: true, email: user.email };
          } catch (err) {
            console.error("Error creating user profile document:", err);
          }
        }
      }

      const hasRole = window.userProfile && window.userProfile.role;
      const isProfileComplete = window.userProfile && window.userProfile.phone && window.userProfile.role;
      
      if (!hasRole) {
        document.getElementById('nav-login').style.display = 'inline-flex';
        document.getElementById('nav-login').textContent = 'Çıkış Yap';
        document.getElementById('profile-dropdown-container').style.display = 'none';
        document.getElementById('nav-notifications').style.display = 'none';
        navigate('/roles');
      } else if (!isProfileComplete) {
        document.getElementById('nav-login').style.display = 'inline-flex';
        document.getElementById('nav-login').textContent = 'Çıkış Yap';
        document.getElementById('profile-dropdown-container').style.display = 'none';
        document.getElementById('nav-notifications').style.display = 'none';
        navigate('/profile');
      } else {
        document.getElementById('nav-login').style.display = 'none';
        document.getElementById('profile-dropdown-container').style.display = 'inline-block';
        document.getElementById('nav-notifications').style.display = 'inline-flex';
        
        setupRealtimeListeners();
        
        if (window.location.pathname === '/' || window.location.pathname === '/profile' || window.location.pathname === '/verify-email' || window.location.pathname === '/roles') {
          navigate('/dashboard');
        } else {
          // Trigger rerender to make sure layout updates
          triggerRerender();
        }
      }
    }
  } else {
    window.currentUserEmail = null;
    window.userProfile = null;
    document.getElementById('nav-login').style.display = 'inline-flex';
    document.getElementById('nav-login').textContent = 'Giriş Yap';
    document.getElementById('profile-dropdown-container').style.display = 'none';
    document.getElementById('nav-notifications').style.display = 'none';
    
    if (window.location.pathname !== '/') {
      navigate('/');
    }
  }
});

const routes = {
  '/': renderAuthPage,
  '/roles': renderRoleSelection,
  '/visitor-options': renderVisitorOptions,
  '/owner-options': renderOwnerOptions,
  '/visitor-wizard': renderVisitorWizard,
  '/owner-wizard': renderOwnerWizard,
  '/dashboard': renderDashboard,
  '/applications': renderApplications,
  '/my-listings': renderMyListings,
  '/admin': renderAdminDashboard,
  '/profile': renderProfile,
  '/verify-email': renderVerifyEmail
}

function navigate(path) {
  window.history.pushState({}, '', path)
  render()
}
window.navigate = navigate;

function render() {
  const path = window.location.pathname;
  
  // Sync nav header visibility dynamically
  if (currentUser) {
    if (currentUser.email === 'apieiron@gmail.com') {
      document.getElementById('nav-login').style.display = 'inline-flex';
      document.getElementById('nav-login').textContent = 'Çıkış Yap';
      document.getElementById('profile-dropdown-container').style.display = 'none';
      document.getElementById('nav-notifications').style.display = 'none';
    } else {
      const isGoogleUser = currentUser.providerData.some(p => p.providerId === 'google.com');
      const isEmailVerified = currentUser.emailVerified || isGoogleUser;
      const isProfileComplete = window.userProfile && window.userProfile.phone && window.userProfile.role;

      if (!isEmailVerified || !isProfileComplete) {
        document.getElementById('nav-login').style.display = 'inline-flex';
        document.getElementById('nav-login').textContent = 'Çıkış Yap';
        document.getElementById('profile-dropdown-container').style.display = 'none';
        document.getElementById('nav-notifications').style.display = 'none';
      } else {
        document.getElementById('nav-login').style.display = 'none';
        document.getElementById('profile-dropdown-container').style.display = 'inline-block';
        document.getElementById('nav-notifications').style.display = 'inline-flex';
      }
    }
  } else {
    document.getElementById('nav-login').style.display = 'inline-flex';
    document.getElementById('nav-login').textContent = 'Giriş Yap';
    document.getElementById('profile-dropdown-container').style.display = 'none';
    document.getElementById('nav-notifications').style.display = 'none';
  }

  // Email Verification Guard
  if (currentUser && currentUser.email !== 'apieiron@gmail.com') {
    const isGoogleUser = currentUser.providerData.some(p => p.providerId === 'google.com');
    const isEmailVerified = currentUser.emailVerified || isGoogleUser;
    
    if (!isEmailVerified && path !== '/verify-email') {
      app.innerHTML = '';
      renderVerifyEmail(app);
      
      const footer = document.getElementById('app-footer');
      if (footer) footer.style.display = 'none';
      return;
    }
    
    if (isEmailVerified) {
      // 1. Role Selection Guard
      const hasRole = window.userProfile && window.userProfile.role;
      if (!hasRole) {
        if (path !== '/roles') {
          app.innerHTML = '';
          renderRoleSelection(app);
          
          const footer = document.getElementById('app-footer');
          if (footer) footer.style.display = 'none';
          return;
        }
      } else {
        // 2. Profile Completeness Guard (requires both phone and role)
        const isProfileComplete = window.userProfile && window.userProfile.phone;
        if (!isProfileComplete && path !== '/profile') {
          app.innerHTML = '';
          renderProfile(app);
          
          const footer = document.getElementById('app-footer');
          if (footer) footer.style.display = 'none';
          return;
        }
      }
    }
  }

  const renderer = routes[path] || routes['/']
  app.innerHTML = ''
  renderer(app)

  // Toggle footer visibility
  const footer = document.getElementById('app-footer');
  if (footer) {
    const isProfileComplete = window.userProfile && window.userProfile.phone && window.userProfile.role;
    const isEmailVerified = currentUser ? (currentUser.emailVerified || currentUser.providerData.some(p => p.providerId === 'google.com')) : false;
    
    if (path === '/' || path === '/admin' || !isEmailVerified || !isProfileComplete) {
      footer.style.display = 'none';
    } else {
      footer.style.display = 'block';
    }
  }
}

// Feedback Modal and Submission Logic
window.openFeedbackModal = function() {
  const modalHtml = `
    <div class="modal-overlay active" id="feedback-modal">
      <div class="modal-content" style="max-width: 450px; padding: 2rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h3 style="margin: 0; font-size: 1.25rem;">Görüş ve Öneri Bildir</h3>
          <button class="modal-close" style="position: static;" onclick="document.getElementById('feedback-modal').remove()">&times;</button>
        </div>
        
        <form id="feedback-form">
          <div class="form-group">
            <label class="form-label" for="feedback-category">Kategori</label>
            <select class="form-control" id="feedback-category" required>
              <option value="">Seçiniz...</option>
              <option value="Genel Görüş">Genel Görüş</option>
              <option value="Ev Sahibi Sistemi">Ev Sahibi Sistemi</option>
              <option value="Gezgin Sistemi">Gezgin Sistemi</option>
              <option value="Hata Bildirimi">Hata Bildirimi</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label" for="feedback-desc">Görüş / Açıklama</label>
            <textarea class="form-control" id="feedback-desc" rows="5" placeholder="Görüş, öneri veya karşılaştığınız hatayı detaylıca yazınız..." required></textarea>
          </div>
          
          <button type="submit" class="btn btn-primary btn-full mt-4">Gönder</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Add submit listener
  document.getElementById('feedback-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = document.getElementById('feedback-category').value;
    const description = document.getElementById('feedback-desc').value.trim();

    try {
      await addDoc(collection(db, 'feedbacks'), {
        userEmail: currentUser ? currentUser.email : 'Misafir',
        userId: currentUser ? currentUser.uid : 'guest',
        category: category,
        description: description,
        createdAt: new Date().getTime(),
        date: new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})
      });

      document.getElementById('feedback-modal').remove();
      window.showCustomAlert('Geri Bildirim Alındı', 'Görüş ve önerileriniz için teşekkür ederiz!', 'success');
    } catch (error) {
      window.showCustomAlert('Hata', 'Geri bildirim gönderilemedi: ' + error.message, 'error');
    }
  });
}

// Custom Alert System
window.showCustomAlert = function(title, message, type = 'success') {
  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error') {
    iconHtml = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e53e3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else {
    iconHtml = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  }

  const alertHtml = `
    <div class="custom-alert-overlay" id="custom-alert">
      <div class="custom-alert-box">
        <div class="custom-alert-icon">
          ${iconHtml}
        </div>
        <div class="custom-alert-title">${title}</div>
        <div class="custom-alert-message">${message}</div>
        <button class="btn btn-primary btn-full" onclick="document.getElementById('custom-alert').remove()">Tamam</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', alertHtml);
  
  setTimeout(() => {
    const alertEl = document.getElementById('custom-alert');
    if (alertEl) alertEl.classList.add('active');
  }, 10);
}

// Helper for dynamic City/District selection
function setupCityDistrict(citySelectId, districtSelectId) {
  const citySelect = document.getElementById(citySelectId);
  const districtSelect = document.getElementById(districtSelectId);
  
  if (!citySelect || !districtSelect) return;

  const capitalize = (str) => {
    if (!str) return '';
    return str.split(' ').map(word => {
      if (!word) return '';
      return word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR');
    }).join(' ');
  }

  citiesData.forEach(city => {
    const option = document.createElement('option');
    option.value = city.name;
    option.textContent = capitalize(city.name);
    citySelect.appendChild(option);
  });

  citySelect.addEventListener('change', (e) => {
    const selectedCityName = e.target.value;
    districtSelect.innerHTML = '<option value="">Seçiniz...</option>';
    
    if (selectedCityName) {
      districtSelect.disabled = false;
      const city = citiesData.find(c => c.name === selectedCityName);
      if (city) {
        city.counties.forEach(county => {
          const option = document.createElement('option');
          option.value = county;
          option.textContent = capitalize(county);
          districtSelect.appendChild(option);
        });
      }
    } else {
      districtSelect.disabled = true;
      districtSelect.innerHTML = '<option value="">Önce Şehir Seçiniz</option>';
    }
  });
}

// Navigation event listeners
document.getElementById('nav-home').addEventListener('click', (e) => {
  e.preventDefault()
  if (!currentUser) {
    navigate('/')
  } else if (currentUser.email === 'apieiron@gmail.com') {
    navigate('/admin')
  } else {
    const isGoogleUser = currentUser.providerData.some(p => p.providerId === 'google.com');
    const isEmailVerified = currentUser.emailVerified || isGoogleUser;
    if (!isEmailVerified) {
      navigate('/verify-email')
    } else {
      const hasRole = window.userProfile && window.userProfile.role;
      if (!hasRole) {
        navigate('/roles')
      } else {
        const isProfileComplete = window.userProfile && window.userProfile.phone;
        if (!isProfileComplete) {
          navigate('/profile')
        } else {
          window.customDashboardFilterApplied = false;
          navigate('/dashboard')
        }
      }
    }
  }
})

// Setup profile dropdown toggling and click outside behavior
const avatarBtn = document.getElementById('profile-avatar-btn');
const dropdownMenu = document.getElementById('profile-dropdown-menu');
if (avatarBtn && dropdownMenu) {
  avatarBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropdownMenu.classList.toggle('active');
  });
  
  document.addEventListener('click', () => {
    dropdownMenu.classList.remove('active');
  });
}

// Bind dropdown menu click actions
document.getElementById('dropdown-profile').addEventListener('click', (e) => {
  e.preventDefault();
  navigate('/profile');
});

document.getElementById('dropdown-listings').addEventListener('click', (e) => {
  e.preventDefault();
  navigate('/my-listings');
});

document.getElementById('dropdown-applications').addEventListener('click', (e) => {
  e.preventDefault();
  navigate('/applications');
});

// Logout handlers for both standard and dropdown
async function handleLogout() {
  try {
    await signOut(auth);
    window.showCustomAlert('Çıkış Yapıldı', 'Güvenli bir şekilde çıkış yaptınız.', 'info');
  } catch (err) {
    console.error("Logout error: ", err);
  }
  navigate('/');
}

document.getElementById('dropdown-logout').addEventListener('click', (e) => {
  e.preventDefault();
  handleLogout();
});

document.getElementById('nav-login').addEventListener('click', async (e) => {
  e.preventDefault()
  if (document.getElementById('nav-login').textContent === 'Çıkış Yap') {
    handleLogout();
  } else {
    navigate('/')
  }
})

document.getElementById('nav-notifications').addEventListener('click', (e) => {
  e.preventDefault()
  window.openNotificationModal()
})

// === PAGES ===

function renderAuthPage(container) {
  container.innerHTML = `
    <div class="auth-wrapper fade-in">
      <div class="glass-card auth-card">
        <h2 class="text-center">Hoş Geldiniz</h2>
        <p class="text-center mb-8">Köye dönüş ve dayanışma ağına katılın.</p>
        
        <button class="btn btn-full btn-google mb-4" id="btn-google-login">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Google ile Devam Et
        </button>
        
        <div class="divider">veya e-posta ile</div>

        <form id="auth-form">
          <div class="form-group">
            <label class="form-label" for="email">E-posta Adresi</label>
            <input type="email" id="email" class="form-control" placeholder="ornek@email.com" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="password">Şifre</label>
            <input type="password" id="password" class="form-control" placeholder="••••••••" required />
          </div>
          
          <div id="cf-turnstile-container" class="mb-4"></div>
          
          <div class="form-group checkbox-group">
            <input type="checkbox" id="kvkk" required />
            <label class="checkbox-label" for="kvkk">
              <a href="#" id="open-kvkk">KVKK Aydınlatma Metni</a>'ni okudum ve kabul ediyorum.
            </label>
          </div>

          <button type="submit" class="btn btn-primary btn-full mt-4">Giriş Yap / Kayıt Ol</button>
        </form>
      </div>
    </div>
  `

  // Render Turnstile
  const renderTurnstile = () => {
    const turnstileContainer = document.getElementById('cf-turnstile-container');
    if (turnstileContainer && window.turnstile) {
      try {
        window.turnstileToken = null;
        window.turnstile.render('#cf-turnstile-container', {
          sitekey: '1x00000000000000000000AA', // Turnstile test sitekey (always passes)
          callback: function(token) {
            window.turnstileToken = token;
          },
          'expired-callback': function() {
            window.turnstileToken = null;
          },
          'error-callback': function() {
            window.turnstileToken = null;
          }
        });
      } catch (err) {
        console.error("Turnstile render error:", err);
      }
    } else if (turnstileContainer) {
      // Retry if turnstile script hasn't loaded yet
      setTimeout(renderTurnstile, 100);
    }
  };
  renderTurnstile();

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault()

    // Turnstile Captcha verification
    if (window.turnstile && !window.turnstileToken) {
      window.showCustomAlert('Doğrulama Gerekli', 'Lütfen güvenlik doğrulamasını (Captcha) tamamlayın.', 'error');
      return;
    }

    const emailVal = document.getElementById('email').value.trim()
    const passwordVal = document.getElementById('password').value
    
    if (emailVal === 'apieiron@gmail.com') {
      window.showCustomAlert('Erişim Engellendi', 'Yönetici hesabı ile e-posta/şifre girişi yapılamaz. Lütfen Google ile Giriş yöntemini kullanın.', 'error');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, emailVal, passwordVal)
      window.showCustomAlert('Giriş Başarılı', 'Başarıyla giriş yapıldı.', 'success')
    } catch (loginError) {
      if (loginError.code === 'auth/user-not-found' || loginError.code === 'auth/invalid-credential') {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, emailVal, passwordVal)
          await sendEmailVerification(userCredential.user)
          window.showCustomAlert('Hesap Oluşturuldu', 'Yeni hesabınız oluşturuldu ve doğrulama e-postası gönderildi. Lütfen e-postanızı onaylayın.', 'info')
        } catch (signUpError) {
          window.showCustomAlert('Hata', 'Kayıt işlemi başarısız: ' + signUpError.message, 'error')
        }
      } else {
        window.showCustomAlert('Hata', 'Giriş yapılamadı: ' + loginError.message, 'error')
      }
    }
  })

  document.getElementById('btn-google-login').addEventListener('click', async () => {
    const kvkkCheckbox = document.getElementById('kvkk');
    if (!kvkkCheckbox || !kvkkCheckbox.checked) {
      window.showCustomAlert('KVKK Onayı Gerekli', 'Google ile oturum açmadan önce lütfen KVKK Aydınlatma Metni\'ni okuyup onaylayınız.', 'error');
      return;
    }
    const provider = new GoogleAuthProvider()
    try {
      await signInWithPopup(auth, provider)
      window.showCustomAlert('Giriş Başarılı', 'Google ile giriş yapıldı.', 'success')
    } catch (error) {
      window.showCustomAlert('Hata', 'Google ile giriş başarısız: ' + error.message, 'error')
    }
  })

  document.getElementById('open-kvkk').addEventListener('click', (e) => {
    e.preventDefault()
    window.showCustomAlert('Aydınlatma Metni', 'Bu uygulama, köye dönmek isteyenler ile köyde destek arayanları bir araya getirmek amacıyla kurulmuş kâr amacı gütmeyen bir sosyal projedir. Bilgileriniz üçüncü şahıslarla paylaşılmaz.', 'info')
  })
}

function renderRoleSelection(container) {
  container.innerHTML = `
    <div class="fade-in">
      <h2 class="text-center">Sizi Nasıl Tanımlayalım?</h2>
      <p class="text-center mb-8">Lütfen platformu hangi amaçla kullanacağınızı seçin.</p>
      
      <div class="roles-grid">
        <div class="card role-card" id="role-owner">
          <div class="role-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <h3>Köyde Evim Var</h3>
          <p>Köydeki işlerim (bahçe, hayvancılık vb.) için desteğe ihtiyacım var ve barınma sağlayabilirim.</p>
        </div>

        <div class="card role-card" id="role-visitor">
          <div class="role-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="10" r="3"></circle>
              <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"></path>
            </svg>
          </div>
          <h3>Gezgin / İş Arayan</h3>
          <p>Doğayla iç içe olmak, çalışmak ve kırsal yaşama destek vermek istiyorum.</p>
        </div>
      </div>
    </div>
  `

  const saveRoleAndNavigate = async (roleVal) => {
    if (!currentUser) return;
    try {
      const updatedProfile = {
        role: roleVal,
        email: currentUser.email,
        updatedAt: new Date().getTime()
      };
      await setDoc(doc(db, 'users', currentUser.uid), updatedProfile, { merge: true });
      if (!window.userProfile) window.userProfile = {};
      window.userProfile.role = roleVal;
      window.userProfile.email = currentUser.email;
      
      window.showCustomAlert('Rol Kaydedildi', 'Rolünüz kaydedildi, lütfen profil bilgilerinizi tamamlayınız.', 'success');
      navigate('/profile');
    } catch (err) {
      window.showCustomAlert('Hata', 'Rol kaydedilemedi: ' + err.message, 'error');
    }
  };

  document.getElementById('role-owner').addEventListener('click', () => saveRoleAndNavigate('owner'));
  document.getElementById('role-visitor').addEventListener('click', () => saveRoleAndNavigate('visitor'));
}

function renderVisitorOptions(container) {
  container.innerHTML = `
    <div class="fade-in" style="max-width: 800px; margin: 0 auto;">
      <h2 class="text-center">Gezgin / İş Arayan</h2>
      <p class="text-center mb-8">Lütfen yapmak istediğiniz işlemi seçin.</p>
      
      <div class="roles-grid">
        <div class="card role-card" id="opt-view-listings">
          <div class="role-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
          </div>
          <h3>İlanları Gör</h3>
          <p>Köyde kalacak yer arayanların oluşturduğu ev sahibi ilanlarını inceleyin ve hemen başvurun.</p>
        </div>

        <div class="card role-card" id="opt-create-listing">
          <div class="role-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </div>
          <h3>Yeni İlan Oluştur</h3>
          <p>Kendi becerilerinizi ve arayışınızı belirten bir ilan oluşturun, ev sahipleri sizi bulsun.</p>
        </div>
      </div>
    </div>
  `

  document.getElementById('opt-view-listings').addEventListener('click', () => {
    window.defaultDashboardFilter = 'owner';
    navigate('/dashboard');
  })
  
  document.getElementById('opt-create-listing').addEventListener('click', () => {
    navigate('/visitor-wizard')
  })
}

function renderOwnerOptions(container) {
  container.innerHTML = `
    <div class="fade-in" style="max-width: 800px; margin: 0 auto;">
      <h2 class="text-center">Köyde Evim Var</h2>
      <p class="text-center mb-8">Lütfen yapmak istediğiniz işlemi seçin.</p>
      
      <div class="roles-grid">
        <div class="card role-card" id="opt-owner-view-listings">
          <div class="role-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
          </div>
          <h3>Gezgin İlanlarını Gör</h3>
          <p>Köyde çalışmak veya konaklamak isteyen gezginlerin ilanlarını inceleyin ve onlara ulaşın.</p>
        </div>

        <div class="card role-card" id="opt-owner-create-listing">
          <div class="role-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </div>
          <h3>Yeni İlan Oluştur</h3>
          <p>Köydeki ihtiyaçlarınızı ve sunacağınız konaklama imkanını belirten bir ilan oluşturun.</p>
        </div>
      </div>
    </div>
  `

  document.getElementById('opt-owner-view-listings').addEventListener('click', () => {
    window.defaultDashboardFilter = 'visitor';
    navigate('/dashboard');
  })
  
  document.getElementById('opt-owner-create-listing').addEventListener('click', () => {
    navigate('/owner-wizard')
  })
}

function renderOwnerWizard(container) {
  container.innerHTML = `
    <div class="fade-in" style="max-width: 600px; margin: 0 auto;">
      <h2 class="text-center mb-8">İlanınızı Oluşturun</h2>
      
      <div class="glass-card">
        <form id="owner-wizard-form">
          <h3 class="mb-4" style="font-size: 1.25rem;">Nerede İhtiyacınız Var?</h3>
          
          <div class="form-group">
            <label class="form-label">Şehir (Zorunlu)</label>
            <select class="form-control" id="owner-city" required>
              <option value="">Seçiniz...</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">İlçe (Zorunlu)</label>
            <select class="form-control" id="owner-district" required disabled>
              <option value="">Önce Şehir Seçiniz</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Köy / Mahalle</label>
            <input type="text" class="form-control" placeholder="Örn: Sultaniçe Köyü" />
          </div>

          <hr class="divider" />
          
          <h3 class="mt-4 mb-4" style="font-size: 1.25rem;">Nasıl Bir Desteğe İhtiyacınız Var?</h3>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="need-1" />
            <label class="checkbox-label" for="need-1">Bahçe & Tarla İşleri (Hasat, çapa vb.)</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="need-2" />
            <label class="checkbox-label" for="need-2">Hayvancılık & Sağım</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="need-3" />
            <label class="checkbox-label" for="need-3">Yaşlı/Hasta Bakımı ve Yoldaşlık</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="need-4" />
            <label class="checkbox-label" for="need-4">Ev İşleri & Yemek Yapımı</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="need-5" />
            <label class="checkbox-label" for="need-5">Ev Tamiratı & İnşaat İşleri</label>
          </div>

          <hr class="divider" />

          <h3 class="mt-4 mb-4" style="font-size: 1.25rem;">Barınma İmkanı</h3>
          <div class="form-group">
            <label class="form-label">Sağlanacak Konaklama Tipi</label>
            <select class="form-control" required>
              <option value="">Seçiniz...</option>
              <option>Ev İçinde Ayrı Oda</option>
              <option>Ayrı Müştemilat / Ev</option>
              <option>Karavan / Çadır Alanı</option>
            </select>
          </div>

          <h3 class="mt-4 mb-4" style="font-size: 1.25rem;">Süreç ve İhtiyaç Dönemi</h3>
          <div class="form-group">
            <label class="form-label">Süre</label>
            <select class="form-control" required>
              <option value="">Seçiniz...</option>
              <option>Yaz Sezonluk (Haziran-Ağustos)</option>
              <option>Kış Sezonluk</option>
              <option>Kısa Süreli (1-2 Hafta)</option>
              <option>Uzun Süreli / Kalıcı</option>
            </select>
          </div>

          <div class="form-group mt-4">
            <label class="form-label">Ek Detaylar ve Beklentileriniz</label>
            <textarea class="form-control" rows="4" placeholder="Örn: Evimizde yaşlı annemiz var, ona yoldaşlık edecek ve yemek işlerine yardım edecek birini arıyoruz..."></textarea>
          </div>

          <button type="submit" class="btn btn-primary btn-full mt-4">İlanı Yayınla</button>
        </form>
      </div>
    </div>
  `

  setupCityDistrict('owner-city', 'owner-district');

  document.getElementById('owner-wizard-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!currentUser) return;
    
    // Quota Check
    const activeOwnerListings = dbListings.filter(l => l.ownerId === currentUser.uid && l.type === 'owner' && l.isActive).length;
    if(activeOwnerListings >= 10) {
      window.showCustomAlert('Kota Doldu', 'En fazla 10 adet aktif ilanınız olabilir. Lütfen ilanlarımdan birini pasife alınız.', 'error');
      return;
    }

    const citySelect = document.getElementById('owner-city');
    const districtSelect = document.getElementById('owner-district');
    const city = citySelect.options[citySelect.selectedIndex].text;
    const district = districtSelect.options[districtSelect.selectedIndex].text;
    const village = e.target.querySelector('input[placeholder="Örn: Sultaniçe Köyü"]').value;
    const desc = e.target.querySelector('textarea').value;
    
    const konaklamaSelect = e.target.querySelectorAll('select')[2];
    const housing = konaklamaSelect ? konaklamaSelect.value : 'Ev İçinde Ayrı Oda';
    
    const sureSelect = e.target.querySelectorAll('select')[3];
    const duration = sureSelect ? sureSelect.value : 'Yaz Sezonluk';

    const skills = [];
    if (document.getElementById('need-1').checked) skills.push('🌱 Bahçe & Tarla');
    if (document.getElementById('need-2').checked) skills.push('🐄 Hayvancılık');
    if (document.getElementById('need-3').checked) skills.push('👵 Yaşlı/Hasta Bakımı');
    if (document.getElementById('need-4').checked) skills.push('🍲 Ev İşleri & Yemek');
    if (document.getElementById('need-5').checked) skills.push('🔨 Tamirat & İnşaat');

    try {
      await addDoc(collection(db, 'listings'), {
        ownerId: currentUser.uid,
        ownerEmail: currentUser.email,
        isActive: true,
        type: 'owner',
        typeLabel: 'Ev Sahibi',
        time: 'Şimdi',
        location: `${city} / ${district} / ${village}`,
        duration: duration,
        housing: housing,
        desc: desc,
        skills: skills,
        actionLabel: 'Başvur',
        color: 'var(--primary)',
        createdAt: new Date().getTime()
      });

      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }

      window.showCustomAlert('Tebrikler!', 'İlanınız başarıyla oluşturuldu!');
      navigate('/dashboard');
    } catch (error) {
      window.showCustomAlert('Hata', 'İlan oluşturulamadı: ' + error.message, 'error');
    }
  })
}

function renderVisitorWizard(container) {
  container.innerHTML = `
    <div class="fade-in" style="max-width: 600px; margin: 0 auto;">
      <h2 class="text-center mb-8">Gezgin İlanı Oluşturun</h2>
      
      <div class="glass-card">
        <form id="visitor-wizard-form">
          <div class="form-group checkbox-group mb-4">
            <input type="checkbox" id="all-turkey" />
            <label class="checkbox-label" for="all-turkey" style="font-weight: 600; color: var(--text-main);">
              Farketmez, Türkiye'nin her yerine gidebilirim.
            </label>
          </div>

          <div id="location-filters">
            <div class="form-group">
              <label class="form-label">Şehir (Opsiyonel)</label>
              <select class="form-control" id="visitor-city">
                <option value="">Seçiniz...</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">İlçe (Opsiyonel)</label>
              <select class="form-control" id="visitor-district" disabled>
                <option value="">Önce Şehir Seçiniz</option>
              </select>
            </div>
          </div>

          <hr class="divider" />
          
          <h3 class="mt-4 mb-4" style="font-size: 1.25rem;">Hangi İşleri Yapabilirsiniz?</h3>
          
          <div class="form-group checkbox-group">
            <input type="checkbox" id="skill-1" />
            <label class="checkbox-label" for="skill-1">Bahçe & Tarla İşleri</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="skill-2" />
            <label class="checkbox-label" for="skill-2">Hayvancılık & Sağım</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="skill-3" />
            <label class="checkbox-label" for="skill-3">Ev İşleri & Yemek</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="skill-4" />
            <label class="checkbox-label" for="skill-4">Yaşlı/Hasta Bakımı</label>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="skill-5" />
            <label class="checkbox-label" for="skill-5">Tamirat & Tadilat</label>
          </div>

          <hr class="divider" />

          <h3 class="mt-4 mb-4" style="font-size: 1.25rem;">Ne Kadarlık Bir Süre İçin Gidebilirsiniz?</h3>
          <div class="form-group">
            <label class="form-label">Zaman / Dönem</label>
            <select class="form-control" required>
              <option value="">Seçiniz...</option>
              <option>Yaz Sezonluk (Haziran-Ağustos)</option>
              <option>Kış Sezonluk</option>
              <option>Kısa Süreli (1-2 Hafta)</option>
              <option>Uzun Süreli / Kalıcı İkamet</option>
            </select>
          </div>

          <div class="form-group mt-4">
            <label class="form-label">Kendinizden Kısaca Bahsedin</label>
            <textarea class="form-control" rows="4" placeholder="Deneyimleriniz veya beklentileriniz..."></textarea>
          </div>

          <button type="submit" class="btn btn-primary btn-full mt-4">İlanı Yayınla</button>
        </form>
      </div>
    </div>
  `

  setupCityDistrict('visitor-city', 'visitor-district');

  document.getElementById('all-turkey').addEventListener('change', (e) => {
    const locFilters = document.getElementById('location-filters')
    if(e.target.checked) {
      locFilters.style.opacity = '0.5'
      locFilters.style.pointerEvents = 'none'
      document.getElementById('visitor-city').value = '';
      const distSelect = document.getElementById('visitor-district');
      distSelect.innerHTML = '<option value="">Önce Şehir Seçiniz</option>';
      distSelect.disabled = true;
    } else {
      locFilters.style.opacity = '1'
      locFilters.style.pointerEvents = 'auto'
    }
  })

  document.getElementById('visitor-wizard-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!currentUser) return;

    // Quota Check
    const activeVisitorListings = dbListings.filter(l => l.ownerId === currentUser.uid && l.type === 'visitor' && l.isActive).length;
    if(activeVisitorListings >= 3) {
      window.showCustomAlert('Kota Doldu', 'En fazla 3 adet aktif ilanınız olabilir. Lütfen ilanlarımdan birini pasife alınız.', 'error');
      return;
    }

    const allTurkey = document.getElementById('all-turkey').checked;
    let location = 'Tüm Türkiye';
    if (!allTurkey) {
      const citySelect = document.getElementById('visitor-city');
      const districtSelect = document.getElementById('visitor-district');
      const city = citySelect.options[citySelect.selectedIndex].text;
      const district = districtSelect.options[districtSelect.selectedIndex].text;
      location = `${city} / ${district}`;
    }

    const sureSelect = e.target.querySelector('select[required]');
    const duration = sureSelect ? sureSelect.value : 'Yaz Sezonluk';
    const desc = e.target.querySelector('textarea').value;

    const skills = [];
    if (document.getElementById('skill-1').checked) skills.push('🌱 Bahçe & Tarla');
    if (document.getElementById('skill-2').checked) skills.push('🐄 Hayvancılık');
    if (document.getElementById('skill-3').checked) skills.push('🍲 Ev İşleri & Yemek');
    if (document.getElementById('skill-4').checked) skills.push('👵 Yaşlı/Hasta Bakımı');
    if (document.getElementById('skill-5').checked) skills.push('🔨 Tamirat & İnşaat');

    try {
      await addDoc(collection(db, 'listings'), {
        ownerId: currentUser.uid,
        ownerEmail: currentUser.email,
        isActive: true,
        type: 'visitor',
        typeLabel: 'Gezgin / İş Arayan',
        time: 'Şimdi',
        location: location,
        duration: duration,
        housing: '-',
        desc: desc,
        skills: skills,
        actionLabel: 'İlanına Çağır',
        color: 'var(--accent)',
        createdAt: new Date().getTime()
      });

      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }

      window.showCustomAlert('Tebrikler!', 'İlanınız başarıyla oluşturuldu!');
      navigate('/dashboard');
    } catch (error) {
      window.showCustomAlert('Hata', 'İlan oluşturulamadı: ' + error.message, 'error');
    }
  })
}

window.defaultDashboardFilter = window.defaultDashboardFilter || 'all';
let isListView = false;

window.sendNotification = async function(userId, title, message) {
  try {
    await addDoc(collection(db, 'notifications'), {
      userId: userId,
      title: title,
      message: message,
      isRead: false,
      createdAt: new Date().getTime(),
      date: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})
    });
  } catch (error) {
    console.error('Notification error:', error);
  }

  if (Notification.permission === 'granted' && currentUser && currentUser.uid === userId) {
    new Notification(title, { body: message });
  }
}

window.openNotificationModal = async function() {
  const badge = document.getElementById('notification-badge');
  if (badge) {
    badge.style.display = 'none';
  }
  
  // Mark all notifications as read in Firestore
  for (const notif of dbNotifications) {
    if (!notif.isRead) {
      try {
        await updateDoc(doc(db, 'notifications', notif.id), { isRead: true });
      } catch (err) {
        console.error(err);
      }
    }
  }

  const modalHtml = `
    <div class="modal-overlay active" id="notif-modal">
      <div class="modal-content" style="max-width: 400px; padding: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="margin: 0;">Bildirimler</h3>
          <button class="modal-close" style="position: static;" onclick="document.getElementById('notif-modal').remove()">&times;</button>
        </div>
        ${dbNotifications.length === 0 ? '<p style="text-align: center; color: var(--text-muted); padding: 2rem 0;">Henüz yeni bir bildiriminiz yok.</p>' : ''}
        <div style="display: flex; flex-direction: column; gap: 0.75rem; max-height: 400px; overflow-y: auto;">
          ${dbNotifications.map(n => `
            <div style="padding: 1rem; background: var(--bg-color); border-radius: var(--radius-sm); border-left: 4px solid var(--primary); ${n.isRead ? 'opacity: 0.7;' : ''}">
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                <strong style="color: var(--text-main); font-size: 0.9rem;">${n.title}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${n.date || ''}</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-main);">${n.message}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.applyToListing = async function(id) {
  if (!currentUser) {
    window.showCustomAlert('Hata', 'Başvuru yapabilmek için giriş yapmalısınız.', 'error');
    return;
  }
  
  const listingItem = dbListings.find(l => l.id === id);
  if (!listingItem) return;

  // Verify applicant has at least 1 active traveler listing
  const myVisitorListings = dbListings.filter(l => l.ownerId === currentUser.uid && l.type === 'visitor' && l.isActive);
  if (myVisitorListings.length === 0) {
    const detailModal = document.getElementById('detail-modal');
    if (detailModal) detailModal.classList.remove('active');
    
    window.showCustomAlert(
      'İlan Gerekli',
      'Ev sahibi ilanlarına başvurabilmek için önce en az 1 adet aktif "Gezgin / İş Arayan" ilanınız bulunmalıdır.',
      'error'
    );
    return;
  }

  try {
    await addDoc(collection(db, 'applications'), {
      applicantId: currentUser.uid,
      applicantEmail: currentUser.email,
      listingId: id,
      listingOwnerId: listingItem.ownerId,
      status: 'bekliyor',
      date: new Date().toLocaleDateString('tr-TR'),
      createdAt: new Date().getTime()
    });

    window.showCustomAlert(
      'Başvuru İletildi', 
      'Başvurunuz ev sahibine iletildi, kabul ederse size profilinizdeki iletişim bilgileri üzerinden ulaşacaktır.'
    );
    
    const detailModal = document.getElementById('detail-modal');
    if (detailModal) detailModal.classList.remove('active');

    // Send real-time notification to the listing owner
    window.sendNotification(
      listingItem.ownerId,
      'Yeni Başvuru!',
      `${currentUser.email} ilanınıza başvurdu.`
    );

    // Simulate real-time response notification to the applicant
    setTimeout(() => {
      window.sendNotification(
        currentUser.uid,
        'Yeni Yanıt!',
        'Ev sahibi başvurunuzu inceledi ve onayladı. İletişime geçebilirsiniz.'
      );
    }, 4000);

  } catch (error) {
    window.showCustomAlert('Hata', 'Başvuru başarısız: ' + error.message, 'error');
  }
}

window.initiateInvitation = function(visitorListingId) {
  if (!currentUser) return;
  const myOwnerListings = dbListings.filter(l => l.ownerId === currentUser.uid && l.type === 'owner' && l.isActive);
  const modalBody = document.getElementById('modal-body');
  
  if (myOwnerListings.length === 0) {
    modalBody.innerHTML = `
      <div class="text-center" style="padding: 2rem 0;">
        <h3 style="margin-bottom: 1rem;">Henüz bir ilanınız yok</h3>
        <p style="margin-bottom: 1.5rem; color: var(--text-muted);">Gezginleri çağırabilmek için önce bir "Köyde Evim Var" ilanı oluşturmanız gerekmektedir.</p>
        <button class="btn btn-primary" onclick="document.getElementById('detail-modal').classList.remove('active'); navigate('/owner-wizard')">İlan Oluştur</button>
      </div>
    `;
    return;
  }
  
  modalBody.innerHTML = `
    <h3 style="margin-bottom: 1rem; font-size: 1.25rem;">Hangi İlanınıza Çağırmak İstiyorsunuz?</h3>
    <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; max-height: 400px; overflow-y: auto; padding-right: 0.5rem;">
      ${myOwnerListings.map(l => `
        <div class="card" style="cursor: pointer; border: 2px solid transparent; transition: all 0.2s; padding: 1rem;" 
             onmouseover="this.style.borderColor='var(--primary)'" 
             onmouseout="this.style.borderColor='transparent'"
             onclick="window.confirmInvitation('${visitorListingId}', '${l.id}')">
          <h4 style="margin: 0 0 0.5rem 0; color: var(--primary);">${l.location}</h4>
          <div style="font-size: 0.875rem; color: var(--text-muted);"><strong>Dönem:</strong> ${l.duration}</div>
          <div style="font-size: 0.875rem; color: var(--text-muted); margin-top: 0.25rem; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${l.desc}</div>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-secondary btn-full" onclick="window.openListingModal('${visitorListingId}')">Geri Dön</button>
  `;
}

window.confirmInvitation = async function(visitorListingId, ownerListingId) {
  if (!currentUser) return;
  const visitorListingItem = dbListings.find(l => l.id === visitorListingId);
  if (!visitorListingItem) return;

  try {
    await addDoc(collection(db, 'applications'), {
      applicantId: visitorListingItem.ownerId,
      applicantEmail: visitorListingItem.ownerEmail || 'Gezgin',
      listingId: visitorListingId,
      invitationFromListingId: ownerListingId,
      listingOwnerId: currentUser.uid,
      status: 'bekliyor',
      date: new Date().toLocaleDateString('tr-TR'),
      createdAt: new Date().getTime()
    });

    window.showCustomAlert(
      'Davet Gönderildi', 
      'Gezgine davetiniz başarıyla gönderildi, size dönüş yapacaktır.'
    );
    
    const detailModal = document.getElementById('detail-modal');
    if (detailModal) detailModal.classList.remove('active');

    // Send real-time notification to the invited traveller
    window.sendNotification(
      visitorListingItem.ownerId,
      'Davet Alındı!',
      `Ev sahibi sizi kendi ilanına davet etti, detaylar için iletişime geçebilirsiniz.`
    );

    // Simulate real-time response notification
    setTimeout(() => {
      window.sendNotification(
        currentUser.uid,
        'Davetinize Yanıt Geldi!',
        'Gezgin davetinizi kabul etti, detaylar için iletişime geçebilirsiniz.'
      );
    }, 4000);

  } catch (error) {
    window.showCustomAlert('Hata', 'Davet gönderilemedi: ' + error.message, 'error');
  }
}

window.defaultDashboardFilter = window.defaultDashboardFilter || 'all';

function renderDashboard(container) {
  // Preset default type filter based on user profile role if custom has not been applied yet
  if (!window.customDashboardFilterApplied) {
    if (window.userProfile && window.userProfile.role === 'owner') {
      window.defaultDashboardFilter = 'visitor';
    } else if (window.userProfile && window.userProfile.role === 'visitor') {
      window.defaultDashboardFilter = 'owner';
    } else {
      window.defaultDashboardFilter = 'all';
    }
  }

  container.innerHTML = `
    <div class="fade-in">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem;">
        <h2 style="margin: 0;">İlan Panosu</h2>
        <div style="display: flex; gap: 0.5rem; align-items: center; width: 100%; justify-content: space-between; margin-top: 0.5rem;" class="dashboard-controls-mobile">
          <button class="btn btn-secondary" id="btn-toggle-filters" style="padding: 0.5rem 1rem; font-size: 0.875rem; flex: 1; justify-content: center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>
            <span id="filter-btn-text">Filtreleri Göster</span>
          </button>
          <button class="btn btn-secondary" id="toggle-view" style="padding: 0.5rem 1rem; font-size: 0.875rem; flex: 1; justify-content: center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.25rem;">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            Liste Görünümü
          </button>
        </div>
      </div>

      <div class="glass-card mb-8 filter-panel" id="filter-panel" style="padding: 1.5rem;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
          
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">İlan Türü</label>
            <select class="form-control" id="filter-type">
              <option value="all" ${window.defaultDashboardFilter === 'all' ? 'selected' : ''}>Tümü</option>
              <option value="owner" ${window.defaultDashboardFilter === 'owner' ? 'selected' : ''}>Köyde Evim Var (Ev Sahibi)</option>
              <option value="visitor" ${window.defaultDashboardFilter === 'visitor' ? 'selected' : ''}>Gezgin / İş Arayan</option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Süre/Dönem</label>
            <select class="form-control" id="filter-duration">
              <option value="all">Tümü</option>
              <option value="summer">Yaz Sezonluk</option>
              <option value="winter">Kış Sezonluk</option>
              <option value="short">Kısa Süreli</option>
              <option value="long">Uzun Süreli / Kalıcı</option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Beceri / İhtiyaç</label>
            <select class="form-control" id="filter-skills">
              <option value="all">Tümü</option>
              <option value="garden">Bahçe & Tarla</option>
              <option value="animals">Hayvancılık</option>
              <option value="care">Yaşlı/Hasta Bakımı</option>
              <option value="house">Ev İşleri & Yemek</option>
              <option value="repair">Tamirat & İnşaat</option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Sıralama</label>
            <select class="form-control" id="filter-sort">
              <option value="newest">En Yeni İlanlar (Önce)</option>
              <option value="oldest">En Eski İlanlar</option>
            </select>
          </div>

        </div>
        
        <div style="display: flex; justify-content: flex-end; margin-top: 1.25rem; gap: 0.5rem;">
          <button class="btn btn-secondary" id="btn-reset-filters" style="font-size: 0.85rem; padding: 0.5rem 1rem;">Temizle</button>
          <button class="btn btn-primary" id="btn-apply-filters" style="font-size: 0.85rem; padding: 0.5rem 1rem;">Filtrele</button>
        </div>
      </div>

      <div id="listings-container"></div>
    </div>

    <!-- İlan Detay Modalı -->
    <div class="modal-overlay" id="detail-modal">
      <div class="modal-content">
        <button class="modal-close" onclick="document.getElementById('detail-modal').classList.remove('active')">&times;</button>
        <div id="modal-body"></div>
      </div>
    </div>
  `;

  // Toggle Filters on Mobile
  const filterPanel = container.querySelector('#filter-panel');
  const btnToggleFilters = container.querySelector('#btn-toggle-filters');
  const filterBtnText = container.querySelector('#filter-btn-text');

  if (btnToggleFilters && filterPanel) {
    btnToggleFilters.addEventListener('click', () => {
      const isExpanded = filterPanel.classList.toggle('expanded');
      filterBtnText.textContent = isExpanded ? 'Filtreleri Gizle' : 'Filtreleri Göster';
    });
  }

  window.openListingModal = function(id) {
    const item = dbListings.find(l => l.id === id);
    if (!item) return;
    const modalBody = document.getElementById('modal-body');
    
    const hasApplied = dbApplications.some(app => app.listingId === item.id && app.applicantId === (currentUser ? currentUser.uid : ''));

    modalBody.innerHTML = `
      <div style="margin-bottom: 1.5rem;">
        <span style="background: ${item.color || 'var(--primary)'}; color: white; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">${item.typeLabel}</span>
        <span style="float: right; color: var(--text-muted); font-size: 0.875rem;">${item.time || 'Yeni'}</span>
      </div>
      <h2 style="margin-bottom: 1rem; font-size: 1.75rem;">${item.location}</h2>
      
      <div style="background: var(--bg-color); padding: 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.5rem; border: 1px solid var(--border-color);">
        <div style="margin-bottom: 0.5rem; color: var(--text-main);"><strong>Süre / Dönem:</strong> ${item.duration}</div>
        ${item.housing && item.housing !== '-' ? `<div style="color: var(--text-main);"><strong>Sağlanan Barınma:</strong> ${item.housing}</div>` : ''}
      </div>

      <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">İlan Açıklaması</h3>
      <p style="margin-bottom: 1.5rem; color: var(--text-main); line-height: 1.6;">${item.desc}</p>

      <h3 style="font-size: 1.1rem; margin-bottom: 0.75rem;">Aranan / Sunulan Beceriler</h3>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 2.5rem;">
        ${item.skills ? item.skills.map(s => `<span style="background: var(--surface); border: 1px solid var(--border-color); padding: 0.5rem 1rem; border-radius: var(--radius-sm); font-size: 0.875rem; color: var(--text-main); font-weight: 500;">${s}</span>`).join('') : ''}
      </div>

      ${item.ownerId === (currentUser ? currentUser.uid : '') 
        ? `<button class="btn btn-secondary btn-full" disabled style="opacity: 0.7; cursor: not-allowed;">Kendi İlanınız</button>`
        : hasApplied
          ? `<button class="btn btn-secondary btn-full" disabled style="opacity: 0.7; cursor: not-allowed;">${item.type === 'visitor' ? 'Davet Gönderildi' : 'Başvuruldu'}</button>`
          : `<button class="btn btn-primary btn-full ${item.type === 'visitor' ? 'btn-secondary' : ''}" onclick="${item.type === 'visitor' ? `window.initiateInvitation('${item.id}')` : `window.applyToListing('${item.id}')`}">${item.actionLabel}</button>`
      }
    `;
    
    document.getElementById('detail-modal').classList.add('active');
  }

  function drawListings() {
    const listContainer = container.querySelector('#listings-container');
    const filterSelect = container.querySelector('#filter-type');
    const typeFilter = filterSelect ? filterSelect.value : (window.defaultDashboardFilter || 'all');

    window.defaultDashboardFilter = 'all';

    const durationSelect = container.querySelector('#filter-duration');
    const durationFilter = durationSelect ? durationSelect.value : 'all';

    const skillsSelect = container.querySelector('#filter-skills');
    const skillsFilter = skillsSelect ? skillsSelect.value : 'all';

    const sortSelect = container.querySelector('#filter-sort');
    const sortFilter = sortSelect ? sortSelect.value : 'newest';

    let activeListings = dbListings.filter(l => {
      if (!l.isActive) return false;
      if (typeFilter !== 'all' && l.type !== typeFilter) return false;
      
      // Duration Filter
      if (durationFilter !== 'all') {
        const text = (l.duration || '').toLowerCase();
        if (durationFilter === 'summer' && !text.includes('yaz')) return false;
        if (durationFilter === 'winter' && !text.includes('kış')) return false;
        if (durationFilter === 'short' && !text.includes('kısa')) return false;
        if (durationFilter === 'long' && !(text.includes('uzun') || text.includes('kalıcı'))) return false;
      }

      // Skills Filter
      if (skillsFilter !== 'all') {
        const skillsText = (l.skills || []).join(' ').toLowerCase();
        if (skillsFilter === 'garden' && !(skillsText.includes('bahçe') || skillsText.includes('tarla'))) return false;
        if (skillsFilter === 'animals' && !(skillsText.includes('hayvan') || skillsText.includes('sağım'))) return false;
        if (skillsFilter === 'care' && !(skillsText.includes('yaşlı') || skillsText.includes('hasta') || skillsText.includes('bakım'))) return false;
        if (skillsFilter === 'house' && !(skillsText.includes('ev') || skillsText.includes('yemek'))) return false;
        if (skillsFilter === 'repair' && !(skillsText.includes('tamirat') || skillsText.includes('inşaat') || skillsText.includes('tadilat'))) return false;
      }

      return true;
    });

    // Sorting
    if (sortFilter === 'newest') {
      activeListings.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      activeListings.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    if (activeListings.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 3rem 0;">
          <p>Panoda görüntülenecek aktif ilan bulunmuyor.</p>
        </div>
      `;
      return;
    }

    if (isListView) {
      listContainer.innerHTML = `
        <div class="table-responsive fade-in">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tür</th>
                <th>Konum</th>
                <th>Dönem</th>
                <th>Barınma</th>
                <th>Beceriler</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              ${activeListings.map(item => {
                return `
                <tr>
                  <td><span style="background: ${item.color || 'var(--primary)'}; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${item.typeLabel}</span></td>
                  <td><strong>${item.location}</strong></td>
                  <td>${item.duration}</td>
                  <td>${item.housing}</td>
                  <td>${item.skills ? item.skills.map(s => `<span class="badge">${s}</span>`).join('') : ''}</td>
                  <td><button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.openListingModal('${item.id}')">İncele</button></td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      listContainer.innerHTML = `
        <div class="roles-grid fade-in">
          ${activeListings.map(item => {
            return `
            <div class="card">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <span style="background: ${item.color || 'var(--primary)'}; color: white; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">${item.typeLabel}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${item.time || 'Yeni'}</span>
              </div>
              <h3 class="mt-4">${item.location}</h3>
              <div style="margin-bottom: 1rem; color: var(--text-muted); font-size: 0.875rem;">
                <strong>Dönem:</strong> ${item.duration} ${item.housing !== '-' ? `| <strong>Barınma:</strong> ${item.housing}` : ''}
              </div>
              <p style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${item.desc}</p>
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.5rem;">
                ${item.skills ? item.skills.map(s => `<span style="background: var(--bg-color); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">${s}</span>`).join('') : ''}
              </div>
              <button class="btn btn-secondary btn-full" style="border-color: ${item.color || 'var(--primary)'}; color: ${item.color || 'var(--primary)'};" onclick="window.openListingModal('${item.id}')">Detayları İncele</button>
            </div>
          `}).join('')}
        </div>
      `;
    }
  }

  drawListings();

  document.getElementById('toggle-view').addEventListener('click', () => {
    isListView = !isListView;
    drawListings();
  });

  // Event Listeners for Filters
  const btnApply = container.querySelector('#btn-apply-filters');
  if (btnApply) {
    btnApply.addEventListener('click', () => {
      window.customDashboardFilterApplied = true;
      drawListings();
      // On mobile, collapse filters after applying
      if (window.innerWidth <= 768) {
        filterPanel.classList.remove('expanded');
        filterBtnText.textContent = 'Filtreleri Göster';
      }
      window.showCustomAlert('Filtrelendi', 'İlan panosu kriterlerinize göre güncellendi.', 'success');
    });
  }

  const btnReset = container.querySelector('#btn-reset-filters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      window.customDashboardFilterApplied = false;
      
      let defaultVal = 'all';
      if (window.userProfile && window.userProfile.role === 'owner') {
        defaultVal = 'visitor';
      } else if (window.userProfile && window.userProfile.role === 'visitor') {
        defaultVal = 'owner';
      }

      container.querySelector('#filter-type').value = defaultVal;
      container.querySelector('#filter-duration').value = 'all';
      container.querySelector('#filter-skills').value = 'all';
      container.querySelector('#filter-sort').value = 'newest';
      drawListings();
      if (window.innerWidth <= 768) {
        filterPanel.classList.remove('expanded');
        filterBtnText.textContent = 'Filtreleri Göster';
      }
      window.showCustomAlert('Sıfırlandı', 'Tüm filtreler temizlendi.', 'info');
    });
  }

  // Type change listener directly
  const filterTypeSelect = container.querySelector('#filter-type');
  if (filterTypeSelect) {
    filterTypeSelect.addEventListener('change', () => {
      window.customDashboardFilterApplied = true;
      drawListings();
    });
  }
}

window.acceptApplication = async function(appId, notifyUserId) {
  try {
    await updateDoc(doc(db, 'applications', appId), { status: 'kabul' });
    window.showCustomAlert('Başvuru Kabul Edildi', 'Başvuruyu onayladınız. Karşı taraf bilgilendirilecektir.', 'success');
    window.sendNotification(
      notifyUserId,
      'Başvurunuz Kabul Edildi!',
      'Yaptığınız başvuru onaylandı. Detaylar ve iletişim için başvurularım sayfasını inceleyebilirsiniz.'
    );
  } catch (err) {
    window.showCustomAlert('Hata', 'Onaylama işlemi başarısız: ' + err.message, 'error');
  }
};

window.rejectApplication = async function(appId, notifyUserId) {
  try {
    await updateDoc(doc(db, 'applications', appId), { status: 'reddedildi' });
    window.showCustomAlert('Başvuru Reddedildi', 'Başvuruyu reddettiniz.', 'info');
    window.sendNotification(
      notifyUserId,
      'Başvuru Durumu',
      'Yaptığınız başvuru bu aşamada onaylanamadı.'
    );
  } catch (err) {
    window.showCustomAlert('Hata', 'Reddetme işlemi başarısız: ' + err.message, 'error');
  }
};

async function renderApplications(container) {
  if (!currentUser) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 4rem 0;">
      <svg class="spinner" width="40" height="40" viewBox="0 0 50 50" style="animation: spin 1s linear infinite; margin-bottom: 1rem; color: var(--primary); display: inline-block;">
        <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="125" stroke-dashoffset="0"></circle>
      </svg>
      <p style="color: var(--text-muted); font-size: 0.95rem;">Başvurular yükleniyor...</p>
    </div>
  `;

  const isOwner = window.userProfile && window.userProfile.role === 'owner';
  
  // Filter received and sent apps
  let received = [];
  let sent = [];
  if (isOwner) {
    received = dbApplications.filter(app => app.listingOwnerId === currentUser.uid && !app.invitationFromListingId);
    sent = dbApplications.filter(app => app.listingOwnerId === currentUser.uid && app.invitationFromListingId);
  } else {
    received = dbApplications.filter(app => app.applicantId === currentUser.uid && app.invitationFromListingId);
    sent = dbApplications.filter(app => app.applicantId === currentUser.uid && !app.invitationFromListingId);
  }

  // Load profile data and active listings for received records
  const receivedData = [];
  for (const item of received) {
    let profile = null;
    let listings = [];
    let targetListing = null;
    let invitationListing = null;
    try {
      const profileId = isOwner ? item.applicantId : item.listingOwnerId;
      const profileDoc = await getDoc(doc(db, 'users', profileId));
      if (profileDoc.exists()) {
        profile = profileDoc.data();
      }

      const listingsQuery = query(
        collection(db, 'listings'),
        where('ownerId', '==', profileId),
        where('isActive', '==', true)
      );
      const listingsSnap = await getDocs(listingsQuery);
      listings = listingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (item.listingId) {
        const listingDoc = await getDoc(doc(db, 'listings', item.listingId));
        if (listingDoc.exists()) {
          targetListing = { id: listingDoc.id, ...listingDoc.data() };
        }
      }

      if (item.invitationFromListingId) {
        const listingDoc = await getDoc(doc(db, 'listings', item.invitationFromListingId));
        if (listingDoc.exists()) {
          invitationListing = { id: listingDoc.id, ...listingDoc.data() };
        }
      }
    } catch (err) {
      console.error("Error loading application detail:", err);
    }
    receivedData.push({ ...item, profile, listings, targetListing, invitationListing });
  }

  const formatWhatsAppNumber = (phoneStr) => {
    if (!phoneStr) return '';
    let cleaned = phoneStr.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '90' + cleaned.substring(1);
    }
    if (cleaned.length === 10 && cleaned.startsWith('5')) {
      cleaned = '90' + cleaned;
    }
    return cleaned;
  };

  const getStatusBadge = (status) => {
    switch(status) {
      case 'bekliyor': return '<span class="badge badge-warning">🟡 Bekliyor</span>';
      case 'kabul': return '<span class="badge badge-success">🟢 Kabul Edildi</span>';
      case 'reddedildi': return '<span class="badge badge-error">🔴 Reddedildi</span>';
      default: return `<span class="badge">${status}</span>`;
    }
  }

  container.innerHTML = `
    <div class="fade-in">
      <h2 style="margin-bottom: 2rem;">Başvuru ve Davet Takibi</h2>
      
      <!-- Section 1: Received Applications/Invitations -->
      <h3 style="margin-bottom: 1.5rem; color: var(--primary); font-size: 1.25rem;">
        ${isOwner ? 'Gelen İlan Başvuruları' : 'Ev Sahiplerinden Gelen Davetler'}
      </h3>
      
      ${receivedData.length === 0 ? `
        <div class="card mb-8" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
          <p>Henüz gelen bir başvuru veya davet bulunmuyor.</p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 1.5rem; margin-bottom: 3rem;">
          ${receivedData.map(data => {
            const profileName = data.profile ? data.profile.displayName : (isOwner ? 'Gezgin' : 'Ev Sahibi');
            const profilePhone = data.profile && data.profile.phone ? data.profile.phone : 'Belirtilmemiş';
            const profileEmail = isOwner 
              ? (data.applicantEmail || (data.profile ? data.profile.email : '') || 'Belirtilmemiş') 
              : ((data.profile && data.profile.email) || (data.invitationListing ? data.invitationListing.ownerEmail : '') || 'Belirtilmemiş');
            const whatsAppNum = data.profile && data.profile.phone ? formatWhatsAppNumber(data.profile.phone) : '';

            return `
              <div class="card" style="display: flex; flex-direction: column; gap: 1.25rem; border-left: 5px solid var(--primary);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                  <h4 style="margin: 0; color: var(--text-main); font-size: 1.1rem;">
                    İlanınız: <span style="color: var(--primary);">${data.targetListing ? data.targetListing.location : 'İlan Detayı'}</span>
                  </h4>
                  ${getStatusBadge(data.status)}
                </div>
                
                <!-- Profile Details -->
                <div style="background: var(--bg-color); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                    <div>
                      <strong style="font-size: 1rem; color: var(--text-main);">${profileName}</strong>
                      <span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 0.5rem;">(${isOwner ? 'Gezgin' : 'Ev Sahibi'})</span>
                    </div>
                    
                    ${data.profile && data.profile.phone ? `
                      <div class="contact-actions">
                        <a href="tel:${data.profile.phone}" class="contact-btn phone-btn" title="Ara">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                        </a>
                        <a href="https://wa.me/${whatsAppNum}" target="_blank" class="contact-btn whatsapp-btn" title="WhatsApp Mesajı">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                        </a>
                      </div>
                    ` : ''}
                  </div>
                  
                  <div style="font-size: 0.875rem; color: var(--text-main); margin-top: 0.5rem;">
                    <strong>Telefon:</strong> ${profilePhone} | <strong>E-posta:</strong> ${profileEmail}
                  </div>
                </div>

                <!-- Invitation Listing Details (If traveler received invitation) -->
                ${!isOwner && data.invitationListing ? `
                  <div style="background: rgba(47, 133, 90, 0.05); padding: 1.25rem; border-radius: var(--radius-md); border: 1px dashed var(--primary); margin-top: 0.25rem;">
                    <h5 style="margin: 0 0 0.5rem 0; font-size: 0.95rem; color: var(--primary); font-weight: 600;">Davet Edildiğiniz Ev Sahibi İlanı:</h5>
                    <div style="font-size: 0.875rem; color: var(--text-main);">
                      <strong style="color: var(--text-main);">${data.invitationListing.location}</strong>
                      <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 0.5rem;">(${data.invitationListing.duration})</span>
                      <p style="margin: 0.5rem 0 0 0; color: var(--text-muted); font-style: italic;">"${data.invitationListing.desc}"</p>
                      ${data.invitationListing.skills ? `
                        <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.5rem;">
                          ${data.invitationListing.skills.map(s => `<span class="badge" style="padding: 0.1rem 0.4rem; font-size: 0.7rem; background: var(--surface); border: 1px solid var(--border-color);">${s}</span>`).join('')}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                ` : ''}

                <!-- Active Listings of the other party -->
                ${data.listings && data.listings.length > 0 ? `
                  <div style="margin-top: 0.5rem;">
                    <h5 style="margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--text-main); font-weight: 600;">${isOwner ? 'Gezginin' : 'Ev Sahibinin'} Yayındaki İlanları:</h5>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                      ${data.listings.map(lst => `
                        <div style="background: var(--bg-color); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-size: 0.85rem;">
                          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; flex-wrap: wrap;">
                            <strong style="color: var(--primary);">${lst.location}</strong>
                            <span style="color: var(--text-muted); font-size: 0.75rem;">${lst.duration}</span>
                          </div>
                          <p style="margin: 0; color: var(--text-main);">${lst.desc}</p>
                          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.5rem;">
                            ${lst.skills ? lst.skills.map(s => `<span class="badge" style="padding: 0.1rem 0.4rem; font-size: 0.7rem; background: var(--surface); border: 1px solid var(--border-color);">${s}</span>`).join('') : ''}
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                ` : `
                  <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">Aktif yayında olan bir ilanı bulunmuyor.</p>
                `}

                <!-- Accept/Reject Actions -->
                ${data.status === 'bekliyor' ? `
                  <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
                    <button class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; border-color: var(--error); color: var(--error);" onclick="window.rejectApplication('${data.id}', '${isOwner ? data.applicantId : data.listingOwnerId}')">Reddet</button>
                    <button class="btn btn-primary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;" onclick="window.acceptApplication('${data.id}', '${isOwner ? data.applicantId : data.listingOwnerId}')">Kabul Et</button>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `}

      <!-- Section 2: Sent Applications/Invitations -->
      <h3 style="margin-bottom: 1.5rem; color: var(--text-main); font-size: 1.25rem; border-top: 1px solid var(--border-color); padding-top: 2rem;">
        ${isOwner ? 'Gezginlere Gönderdiğiniz Davetler' : 'Gönderdiğiniz İlan Başvuruları'}
      </h3>

      ${sent.length === 0 ? `
        <div class="card" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
          <p>Henüz gönderdiğiniz bir başvuru veya davet bulunmuyor.</p>
        </div>
      ` : `
        <div class="roles-grid list-view">
          ${sent.map(app => {
            const listing = dbListings.find(l => l.id === app.listingId);
            if (!listing) return '';
            return `
              <div class="card" style="display: flex; flex-direction: column; gap: 1rem; opacity: 0.9;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <h3 style="margin: 0; font-size: 1.1rem;">${listing.location}</h3>
                  ${getStatusBadge(app.status)}
                </div>
                <div style="color: var(--text-muted); font-size: 0.85rem;">
                  <strong>Tarih:</strong> ${app.date} | <strong>İlan Türü:</strong> ${listing.typeLabel}
                </div>
                <div style="background: var(--bg-color); padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.85rem;">
                  ${listing.desc.substring(0, 100)}...
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

window.toggleListingActive = async function(id) {
  const listingItem = dbListings.find(l => l.id === id);
  if (!listingItem) return;

  try {
    await updateDoc(doc(db, 'listings', id), {
      isActive: !listingItem.isActive
    });
    window.showCustomAlert(
      listingItem.isActive ? 'İlan Pasifleştirildi' : 'İlan Aktifleştirildi', 
      listingItem.isActive ? 'İlanınız yayından kaldırıldı.' : 'İlanınız tekrar yayına alındı.', 
      'info'
    );
  } catch (error) {
    window.showCustomAlert('Hata', 'İşlem başarısız: ' + error.message, 'error');
  }
}

function renderMyListings(container) {
  if (!currentUser) return;
  const myListings = dbListings.filter(l => l.ownerId === currentUser.uid);
  
  const targetWizard = window.userProfile && window.userProfile.role === 'owner' ? '/owner-wizard' : '/visitor-wizard';

  if (myListings.length === 0) {
    container.innerHTML = `
      <div class="fade-in text-center" style="padding: 4rem 0;">
        <h2>Henüz bir ilanınız yok</h2>
        <p class="mb-4">Hemen yeni bir ilan oluşturabilirsiniz.</p>
        <button class="btn btn-primary mt-4" onclick="navigate('${targetWizard}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Yeni İlan Oluştur
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="fade-in">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem;">
        <h2 style="margin: 0;">İlanlarım</h2>
        <button class="btn btn-primary" onclick="navigate('${targetWizard}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Yeni İlan Oluştur
        </button>
      </div>
      <div class="roles-grid list-view">
        ${myListings.map(listing => `
          <div class="card" style="display: flex; flex-direction: column; gap: 1rem; opacity: ${listing.isActive ? '1' : '0.6'}; transition: all 0.3s ease;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 style="margin: 0;">${listing.location}</h3>
              <span class="badge ${listing.isActive ? 'badge-success' : 'badge-error'}">${listing.isActive ? 'Aktif' : 'Pasif'}</span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.875rem;">
              <strong>İlan Türü:</strong> ${listing.typeLabel}
            </div>
            <div style="background: var(--bg-color); padding: 1rem; border-radius: var(--radius-sm); font-size: 0.875rem;">
              ${listing.desc.substring(0, 100)}...
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem; gap: 0.5rem;">
              <button class="btn ${listing.isActive ? 'btn-secondary' : 'btn-primary'}" style="font-size: 0.75rem; padding: 0.5rem 1rem;" onclick="window.toggleListingActive('${listing.id}')">
                ${listing.isActive ? 'Pasife Al' : 'Aktife Al'}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

window.deleteFeedback = async function(id) {
  try {
    await deleteDoc(doc(db, 'feedbacks', id));
    window.showCustomAlert('Başarılı', 'Geri bildirim silindi.', 'success');
  } catch (error) {
    window.showCustomAlert('Hata', 'Silme işlemi başarısız: ' + error.message, 'error');
  }
}

function renderAdminDashboard(container) {
  if (!currentUser || currentUser.email !== 'apieiron@gmail.com') {
    container.innerHTML = `
      <div class="fade-in text-center" style="padding: 4rem 0;">
        <h2 style="color: var(--error);">Yetkisiz Erişim</h2>
        <p class="mb-4">Bu sayfayı görüntülemek için admin hesabı ile giriş yapmalısınız.</p>
        <button class="btn btn-primary" onclick="navigate('/')">Giriş Sayfasına Git</button>
      </div>
    `;
    return;
  }

  // Calculate stats
  const totalUsers = 1248; // Simulated base users
  const activeListings = dbListings.filter(l => l.isActive).length;
  const totalApplications = dbApplications.length;
  const totalFeedbacks = dbFeedbacks.length;

  container.innerHTML = `
    <div class="fade-in">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <div>
          <h2 style="margin: 0;">Yönetici Paneli</h2>
          <p style="margin: 0; color: var(--text-muted);">Sistem durumunu ve kullanıcı geri bildirimlerini buradan inceleyebilirsiniz.</p>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="admin-stats-grid">
        <div class="admin-stat-card">
          <div class="admin-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div class="admin-stat-info">
            <span class="admin-stat-value">${totalUsers}</span>
            <span class="admin-stat-label">Toplam Kayıtlı Üye</span>
          </div>
        </div>

        <div class="admin-stat-card">
          <div class="admin-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </div>
          <div class="admin-stat-info">
            <span class="admin-stat-value">${activeListings}</span>
            <span class="admin-stat-label">Aktif İlan Sayısı</span>
          </div>
        </div>

        <div class="admin-stat-card">
          <div class="admin-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <div class="admin-stat-info">
            <span class="admin-stat-value">${totalApplications}</span>
            <span class="admin-stat-label">Toplam Başvuru</span>
          </div>
        </div>

        <div class="admin-stat-card">
          <div class="admin-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="admin-stat-info">
            <span class="admin-stat-value">${totalFeedbacks}</span>
            <span class="admin-stat-label">Görüş & Öneri</span>
          </div>
        </div>
      </div>

      <!-- Feedbacks Table Section -->
      <div class="glass-card" style="padding: 2rem;">
        <h3 style="margin-bottom: 1.5rem; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          Gelen Görüş ve Hata Bildirimleri
        </h3>

        ${dbFeedbacks.length === 0 ? `
          <div style="text-align: center; color: var(--text-muted); padding: 3rem 0;">
            <p style="font-size: 1rem; margin-bottom: 0;">Henüz kayıtlı bir görüş veya öneri bulunmamaktadır.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Kullanıcı</th>
                  <th>Kategori</th>
                  <th>Görüş / Açıklama</th>
                  <th style="text-align: right;">İşlem</th>
                </tr>
              </thead>
              <tbody>
                ${dbFeedbacks.map(fb => {
                  let badgeClass = 'badge-info';
                  if (fb.category === 'Ev Sahibi Sistemi') badgeClass = 'badge-success';
                  if (fb.category === 'Gezgin Sistemi') badgeClass = 'badge-warning';

                  return `
                    <tr>
                      <td style="white-space: nowrap; color: var(--text-muted); font-size: 0.8rem;">${fb.date || ''}</td>
                      <td style="font-weight: 500;">${fb.userEmail || ''}</td>
                      <td><span class="badge ${badgeClass}">${fb.category || ''}</span></td>
                      <td style="max-width: 400px; line-height: 1.5; color: var(--text-main); word-wrap: break-word; white-space: normal;">
                        ${fb.description || ''}
                      </td>
                      <td style="text-align: right; white-space: nowrap;">
                        <button class="btn-delete" onclick="window.deleteFeedback('${fb.id}')">Sil</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderProfile(container) {
  const nameVal = window.userProfile ? (window.userProfile.displayName || '') : (currentUser ? (currentUser.displayName || '') : '');
  const phoneVal = window.userProfile ? (window.userProfile.phone || '') : '';
  const selectedRole = window.userProfile ? (window.userProfile.role || '') : '';
  const isComplete = window.userProfile && window.userProfile.phone && window.userProfile.role;

  container.innerHTML = `
    <div class="fade-in" style="max-width: 500px; margin: 0 auto;">
      <h2 class="text-center mb-4">Profil Bilgileri</h2>
      <p class="text-center mb-8" style="color: var(--text-muted); font-size: 0.95rem;">
        ${isComplete 
          ? 'Profil bilgilerinizi buradan güncelleyebilirsiniz.' 
          : 'Uygulamayı kullanmaya başlamadan önce lütfen adınızı, telefon numaranızı ve rolünüzü seçiniz.'}
      </p>

      <div class="glass-card" style="padding: 2rem;">
        <form id="profile-form">
          <div class="form-group">
            <label class="form-label" for="profile-name">Ad Soyad (Zorunlu)</label>
            <input type="text" id="profile-name" class="form-control" placeholder="Adınız Soyadınız" value="${nameVal}" required />
          </div>
          
          <div class="form-group">
            <label class="form-label" for="profile-phone">Telefon Numarası (Zorunlu)</label>
            <input type="tel" id="profile-phone" class="form-control" placeholder="05XXXXXXXXX" pattern="05[0-9]{9}" title="Lütfen 05 ile başlayan 11 haneli telefon numaranızı giriniz (Örn: 05551234567)" value="${phoneVal}" required />
            <small style="color: var(--text-muted); font-size: 0.75rem; display: block; margin-top: 0.25rem;">Numaranızı başında 0 olacak şekilde 11 hane olarak boşluksuz giriniz.</small>
          </div>

          <div class="form-group">
            <label class="form-label" for="profile-role">Rolünüz (Zorunlu)</label>
            <select id="profile-role" class="form-control" required>
              <option value="">Seçiniz...</option>
              <option value="owner" ${selectedRole === 'owner' ? 'selected' : ''}>Köyde Evim Var (Ev Sahibi)</option>
              <option value="visitor" ${selectedRole === 'visitor' ? 'selected' : ''}>Gezgin / İş Arayan</option>
            </select>
            <small style="color: var(--text-muted); font-size: 0.75rem; display: block; margin-top: 0.25rem;">Rolünüzü değiştirdiğiniz takdirde diğer roldeki mevcut tüm aktif ilanlarınız otomatik olarak pasifleştirilecektir.</small>
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
            ${isComplete ? `<button type="button" class="btn btn-secondary" id="btn-profile-cancel" style="flex: 1;">İptal</button>` : ''}
            <button type="submit" class="btn btn-primary" style="flex: 2;">Profilimi Kaydet</button>
          </div>
        </form>
      </div>
    </div>
  `;

  if (isComplete) {
    document.getElementById('btn-profile-cancel').addEventListener('click', () => {
      navigate('/dashboard');
    });
  }

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('profile-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const role = document.getElementById('profile-role').value;

    const currentRole = window.userProfile ? window.userProfile.role : '';

    if (currentRole && currentRole !== role) {
      const confirmChange = confirm("Rolünüzü değiştirmek istediğinize emin misiniz? Rol değiştiğinde diğer gruptayken vermiş olduğunuz tüm ilanlar pasif hale getirilecektir.");
      if (!confirmChange) {
        return;
      }

      // Deactivate old listings in Firestore
      const oldListings = dbListings.filter(l => l.ownerId === currentUser.uid && l.type === currentRole && l.isActive);
      for (const lst of oldListings) {
        try {
          await updateDoc(doc(db, 'listings', lst.id), { isActive: false });
        } catch (err) {
          console.error("Listing deactivate error:", err);
        }
      }
    }

    try {
      const updatedProfile = {
        displayName: name,
        phone: phone,
        role: role,
        email: currentUser.email,
        updatedAt: new Date().getTime()
      };

      await setDoc(doc(db, 'users', currentUser.uid), updatedProfile, { merge: true });
      window.userProfile = updatedProfile;

      window.showCustomAlert('Profil Güncellendi', 'Bilgileriniz başarıyla kaydedildi.', 'success');
      
      // Enable navigation dropdown & notifications
      document.getElementById('profile-dropdown-container').style.display = 'inline-block';
      document.getElementById('nav-notifications').style.display = 'inline-flex';
      
      setupRealtimeListeners();

      window.customDashboardFilterApplied = false; // Reset to load new default type filter
      navigate('/dashboard');
    } catch (err) {
      window.showCustomAlert('Hata', 'Profil kaydedilemedi: ' + err.message, 'error');
    }
  });
}

function renderVerifyEmail(container) {
  container.innerHTML = `
    <div class="fade-in" style="max-width: 500px; margin: 0 auto;">
      <h2 class="text-center mb-4">E-posta Doğrulama</h2>
      <p class="text-center mb-8" style="color: var(--text-muted);">
        Lütfen hesabınızı etkinleştirmek için e-posta adresinize gönderilen doğrulama bağlantısına tıklayın.
      </p>

      <div class="glass-card text-center" style="padding: 2.5rem 2rem;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">✉️</div>
        <h3 class="mb-4" style="font-size: 1.25rem;">Doğrulama Bağlantısı Gönderildi</h3>
        <p style="font-size: 0.95rem; color: var(--text-main); margin-bottom: 2rem;">
          <b>${currentUser ? currentUser.email : ''}</b> adresine bir doğrulama e-postası gönderdik. Bağlantıya tıkladıktan sonra aşağıdaki kontrol butonuna basınız.
        </p>

        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <button class="btn btn-primary btn-full" id="btn-check-verification">Doğrulamayı Kontrol Et</button>
          <button class="btn btn-secondary btn-full" id="btn-resend-verification">E-postayı Yeniden Gönder</button>
          <button class="btn btn-secondary btn-full" id="btn-verify-logout" style="border-color: var(--error); color: var(--error);">Çıkış Yap</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-check-verification').addEventListener('click', async () => {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        window.showCustomAlert('Başarılı', 'E-posta adresiniz doğrulandı. Yönlendiriliyorsunuz...', 'success');
        
        // Fetch profile
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          window.userProfile = userDoc.data();
        } else {
          window.userProfile = null;
        }

        const hasRole = window.userProfile && window.userProfile.role;
        const isProfileComplete = window.userProfile && window.userProfile.phone && window.userProfile.role;
        
        if (!hasRole) {
          navigate('/roles');
        } else if (!isProfileComplete) {
          navigate('/profile');
        } else {
          navigate('/dashboard');
        }
      } else {
        window.showCustomAlert('Doğrulanamadı', 'E-posta adresiniz henüz doğrulanmamış görünüyor. Lütfen gelen e-postadaki linke tıklayıp onaylayın.', 'warning');
      }
    } catch (err) {
      window.showCustomAlert('Hata', 'Kontrol edilirken hata oluştu: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-resend-verification').addEventListener('click', async () => {
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      window.showCustomAlert('Gönderildi', 'Doğrulama e-postası tekrar gönderildi. Lütfen kutunuzu kontrol edin.', 'success');
    } catch (err) {
      window.showCustomAlert('Hata', 'Gönderilemedi: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-verify-logout').addEventListener('click', async () => {
    try {
      await signOut(auth);
      window.showCustomAlert('Çıkış Yapıldı', 'Oturum sonlandırıldı.', 'info');
      navigate('/');
    } catch (err) {
      console.error(err);
    }
  });
}

// Initial render
window.addEventListener('popstate', render)
render()
