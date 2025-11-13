// Importar servicios necesarios
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    setLogLevel, 
    doc, 
    setDoc, 
    collection, 
    addDoc, 
    getDoc, 
    onSnapshot, 
    query, 
    Timestamp, 
    deleteDoc, 
    getDocs // ¡ASEGÚRATE DE QUE getDocs ESTÁ IMPORTADO!
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- Variables Globales ---
let app, db, auth, storage;
let propertiesCollection;
let userId = null;
let currentUser = null; // Almacenar el objeto de usuario
let authTransitioning = false; // bandera para evitar re-autenticación anónima durante cambios
let adminMap, adminMarker, detailMap, detailMarker;
let selectedFiles = []; 
let propIdToDelete = null; 
let allPublishedProperties = [];
let unsubscribePending = () => {}; // Para detener listeners
let unsubscribePublished = () => {};
let unsubscribeBarrios = () => {};

// --- Configuración de Firebase Local (para Go Live) ---
const localFirebaseConfig = {
    apiKey: "AIzaSyAJTWTL4JRbl0-YUsFgsADPEiBM9s_O0HI",
    authDomain: "inmobiliaria-mz.firebaseapp.com",
    projectId: "inmobiliaria-mz",
    storageBucket: "inmobiliaria-mz.firebasestorage.app",
    messagingSenderId: "361999685253",
    appId: "1:361999685253:web:ff908124d39bb8172abbec",
    measurementId: "G-PBFQQ1GBHJ"
};
// ¡¡NUEVA RUTA SIMPLE!!
const collectionPath = "properties"; 

// --- Función de Inicialización Principal ---
function initializeMainApp() {
    try {
        const firebaseConfig = window.__firebase_config ? JSON.parse(window.__firebase_config) : localFirebaseConfig;
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        storage = getStorage(app);
        setLogLevel('Debug');
        // ¡¡NUEVA RUTA SIMPLE!!
        propertiesCollection = collection(db, collectionPath);
        
        // Manejar autenticación
        onAuthStateChanged(auth, async (user) => {
            currentUser = user; // Guardar el estado del usuario
            
            if (user) {
                userId = user.uid;
                console.log("Usuario autenticado:", userId);
                
                document.getElementById('auth-info').style.display = 'flex';
                
                // Es un usuario de STAFF (Email)
                if (user.email) {
                    document.getElementById('auth-status').innerText = `Conectado: ${user.email}`;
                    document.getElementById('auth-status').className = "font-medium text-green-600";
                    document.getElementById('logout-btn').style.display = 'block';
                    document.getElementById('user-id-display').innerText = `UserID: ${userId.substring(0, 8)}...`;
                    
                    // Habilitar formularios de staff (se habilitarán DESPUÉS de cargar datos)
                    
                    // Mostrar menú de staff (si no estamos en una vista de staff)
                    if (document.getElementById('login-view').style.display === 'block') {
                        document.getElementById('staff-welcome-msg').innerText = `¡Bienvenido ${user.email}! Seleccione su panel:`;
                        showView('staff-nav-view');
                    }
                    
                    // Cargar datos que el staff necesita
                    loadPendingProperties();
                    
                } else { // Es un CLIENTE (Anónimo)
                    document.getElementById('auth-status').innerText = "Conectado (Cliente)";
                    document.getElementById('auth-status').className = "font-medium text-slate-600";
                    document.getElementById('logout-btn').style.display = 'none';
                    
                    // Asegurarse de que los formularios de staff estén deshabilitados
                    document.getElementById('captador-submit-btn').disabled = true;
                    document.getElementById('admin-submit-btn').disabled = true;
                    document.getElementById('prop-files').disabled = true;
                }
                
                // Cargar datos públicos (para todos)
                loadAndDisplayPublishedProperties(); 
                loadBarriosList(); 

            } else { // No hay usuario
                console.log("No hay usuario, iniciando sesión anónima para clientes...");
                document.getElementById('auth-status').innerText = "Visitante";
                document.getElementById('auth-status').className = "font-medium text-slate-500";
                document.getElementById('logout-btn').style.display = 'none';
                
                // Desconectar listeners (si existían)
                unsubscribePending();
                unsubscribePublished();
                unsubscribeBarrios();
                
                // Evitar que, si estamos en medio de una transición de auth, iniciemos anónimo automáticamente
                if (authTransitioning) {
                    console.log('onAuthStateChanged: authTransitioning activo, posponiendo inicio anónimo');
                    return;
                }

                // Iniciar sesión anónima automáticamente
                try {
                    if (window.__initial_auth_token) {
                        await signInWithCustomToken(auth, window.__initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (authError) {
                    console.error("Error de autenticación anónima:", authError);
                    if (authError.code === 'auth/custom-token-mismatch') {
                        console.warn("Custom token mismatch, intentando anónimo...");
                        await signInAnonymously(auth);
                    } else {
                        document.getElementById('init-error').innerText = "Error al conectar con el servidor.";
                    }
                }
            }
        });
        
        showView('login-view');
        setupFormListeners();

    } catch (error) {
        console.error("Error al inicializar Firebase:", error);
        document.getElementById('init-error').innerText = "Error crítico al cargar la configuración.";
    }
}

// --- Configuración de Listeners de Formularios ---
function setupFormListeners() {
    console.log('setupFormListeners: adjuntando listeners de formularios');
    // Formulario de Login de Staff
    document.getElementById('staff-login-form').addEventListener('submit', handleStaffLogin);
    
    // Botón de Cerrar Sesión
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // Formulario del Captador
    document.getElementById('captador-form').addEventListener('submit', handleCaptadorSubmit);
    // Listener adicional de depuración para el botón (ayuda a detectar clicks cuando está disabled)
    const captBtn = document.getElementById('captador-submit-btn');
    if (captBtn) {
        captBtn.addEventListener('click', (ev) => {
            console.log('captador-submit-btn click event (debug). disabled=', ev.target.disabled);
        });
    }
    
    // Formulario de Administración
    document.getElementById('admin-form').addEventListener('submit', handleAdminSubmit);
    document.getElementById('admin-form-clear').addEventListener('click', clearAdminForm);
    // Búsqueda rápida y eliminación por ID (Admin)
    const adminSearchBtn = document.getElementById('admin-search-btn');
    if (adminSearchBtn) adminSearchBtn.addEventListener('click', adminSearchById);
    const adminDeleteIdBtn = document.getElementById('admin-delete-id-btn');
    if (adminDeleteIdBtn) adminDeleteIdBtn.addEventListener('click', adminDeleteById);
    const adminDeleteCurrentBtn = document.getElementById('admin-delete-current-btn');
    if (adminDeleteCurrentBtn) adminDeleteCurrentBtn.addEventListener('click', adminDeleteCurrent);
    // Búsqueda por domicilio (autocompletar parcial)
    const adminSearchAddress = document.getElementById('admin-search-address');
    if (adminSearchAddress) {
        adminSearchAddress.addEventListener('input', (e) => debouncedAdminAddressSearch(e.target.value));
    }
    

// --- Búsqueda y Eliminación por ID (Admin) ---
async function adminSearchById() {
    const id = document.getElementById('admin-search-id').value.trim();
    const statusEl = document.getElementById('admin-search-status');
    if (!id) {
        statusEl.innerText = 'Ingrese un ID válido.';
        return;
    }
    statusEl.innerText = 'Buscando...';
    try {
        await loadPendingPropertyToForm(id);
        statusEl.innerText = 'Propiedad cargada en el formulario.';
    } catch (error) {
        console.error('adminSearchById error:', error);
        statusEl.innerText = 'Error al buscar la propiedad.';
    }
}

async function adminDeleteById() {
    const id = document.getElementById('admin-search-id').value.trim();
    const statusEl = document.getElementById('admin-search-status');
    if (!id) {
        statusEl.innerText = 'Ingrese un ID válido para eliminar.';
        return;
    }
    if (!confirm('¿Confirma que desea eliminar la propiedad con ID: ' + id + '? Esta acción no se puede deshacer.')) return;
    statusEl.innerText = 'Eliminando...';
    try {
        const docRef = doc(propertiesCollection, id);
        await deleteDoc(docRef);
        statusEl.innerText = 'Propiedad eliminada.';
        // Si el formulario estaba cargando esa propiedad, limpiarlo
        if (document.getElementById('prop-id').value === id) clearAdminForm();
    } catch (error) {
        console.error('adminDeleteById error:', error);
        statusEl.innerText = 'Error al eliminar: ' + (error.message || error.code || '');
    }
}

// Eliminar la propiedad actualmente cargada en el formulario (si existe prop-id)
async function adminDeleteCurrent() {
    const propId = document.getElementById('prop-id').value;
    if (!propId) {
        alert('No hay ninguna propiedad cargada. Busque o cargue una propiedad primero.');
        return;
    }
    if (!confirm('¿Confirma que desea eliminar la propiedad con ID: ' + propId + '? Esta acción es irreversible.')) return;

    const statusEl = document.getElementById('admin-form-status');
    try {
        statusEl.innerText = 'Eliminando propiedad...';
        const docRef = doc(propertiesCollection, propId);
        await deleteDoc(docRef);
        statusEl.innerText = 'Propiedad eliminada.';
        clearAdminForm();
    } catch (error) {
        console.error('adminDeleteCurrent error:', error);
        statusEl.innerText = 'Error al eliminar: ' + (error.message || error.code || '');
    }
}

// --- Búsqueda por domicilio ---
let adminAddressDebounceTimer = null;
function debouncedAdminAddressSearch(value) {
    clearTimeout(adminAddressDebounceTimer);
    adminAddressDebounceTimer = setTimeout(() => adminSearchByAddress(value), 300);
}

async function adminSearchByAddress(raw) {
    const qstr = String(raw || '').trim();
    const resultsEl = document.getElementById('admin-search-address-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    if (qstr.length < 3) return; // requerimos al menos 3 caracteres

    const needle = qstr.toLowerCase();
    // Obtener todos los documentos y filtrar localmente por coincidencia parcial
    try {
        const snapshot = await getDocs(propertiesCollection);
        const matches = [];
        snapshot.forEach(d => {
            const p = d.data();
            const street = (p.address?.street || '').toString().toLowerCase();
            const num = (p.address?.num || '').toString().toLowerCase();
            const combined = (street + ' ' + num).trim();
            if (street.includes(needle) || num.includes(needle) || combined.includes(needle)) {
                matches.push({ id: d.id, data: p });
            }
        });

        if (matches.length === 0) {
            resultsEl.innerHTML = '<p class="text-sm text-slate-500">No se encontraron coincidencias.</p>';
            return;
        }

        // Mostrar lista de resultados clicables
        const list = document.createElement('div');
        list.className = 'space-y-2';
        matches.slice(0, 20).forEach(m => {
            const row = document.createElement('div');
            row.className = 'p-2 border rounded hover:bg-slate-100 cursor-pointer flex justify-between items-center';
            const left = document.createElement('div');
            left.innerHTML = `<div class="font-medium">${escapeHtml(m.data.address?.street || 'Sin dirección')} ${escapeHtml(m.data.address?.num || '')}</div><div class="text-sm text-slate-600">${escapeHtml(m.data.address?.barrio || '')} — ${escapeHtml(m.data.type || '')}</div>`;
            const right = document.createElement('div');
            right.innerHTML = `<small class="text-xs text-slate-500">ID: ${m.id}</small>`;
            row.appendChild(left);
            row.appendChild(right);
            row.addEventListener('click', () => {
                // Cargar la propiedad en el formulario
                document.getElementById('admin-search-address').value = `${m.data.address?.street || ''} ${m.data.address?.num || ''}`;
                resultsEl.innerHTML = '';
                loadPendingPropertyToForm(m.id);
            });
            list.appendChild(row);
        });
        resultsEl.appendChild(list);

    } catch (error) {
        console.error('adminSearchByAddress error:', error);
        resultsEl.innerHTML = '<p class="text-sm text-red-600">Error al buscar. Revisa la consola.</p>';
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"'`]/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;","`":"&#96;"}[s]));
}
    // Listener para la carga de archivos
    document.getElementById('prop-files').addEventListener('change', handleFileSelection);

    // Listeners del Modal de Borrado
    document.getElementById('delete-modal-cancel').addEventListener('click', () => {
        propIdToDelete = null;
        document.getElementById('delete-modal').style.display = 'none';
    });
    document.getElementById('delete-modal-confirm').addEventListener('click', handleDeleteConfirm);
    
    // Listener del Modal de Detalle (Cliente)
    document.getElementById('detail-modal-close').addEventListener('click', () => {
         document.getElementById('detail-modal').style.display = 'none';
         if (detailMap) {
            detailMap.remove();
            detailMap = null;
         }
    });
}

// --- Lógica de Autenticación de Staff ---
async function handleStaffLogin(e) {
    e.preventDefault();
    const email = document.getElementById('staff-email').value;
    const password = document.getElementById('staff-password').value;
    const statusEl = document.getElementById('staff-login-status');
    const loginBtn = document.getElementById('staff-login-btn');

    statusEl.innerText = "Ingresando...";
    statusEl.className = 'text-xs text-blue-500 mt-2 text-center';
    loginBtn.disabled = true;

    try {
        // 1. Cerrar la sesión anónima actual
        if (currentUser && currentUser.isAnonymous) {
            // Evitar que onAuthStateChanged vuelva a iniciar anónimo mientras hacemos el cambio
            authTransitioning = true;
            try {
                await signOut(auth);
            } catch (e) {
                console.warn('handleStaffLogin: error al signOut previo (continuando):', e);
            }
        }
        
        // 2. Iniciar sesión con Email/Password
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        console.log("Inicio de sesión de Staff exitoso:", userCredential.user.email);
        // Ya finalizó la transición de auth
        authTransitioning = false;
        // onAuthStateChanged se encargará de mostrar la vista staff-nav-view
        
    } catch (error) {
        console.error("Error de inicio de sesión:", error.code);
        if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            statusEl.innerText = "Email o contraseña incorrectos.";
        } else {
            statusEl.innerText = "Error al ingresar. Intente de nuevo.";
        }
        statusEl.className = 'text-xs text-red-500 mt-2 text-center';
        
        // Si el login falla, volver a sesión anónima
        if (!currentUser) {
            // Si se produjo un error y no tenemos usuario, permitir re-anonizar
            try {
                await signInAnonymously(auth);
            } catch (e) {
                console.error('Error iniciando sesión anónima tras fallo de login:', e);
            }
        }
        authTransitioning = false;
        
    } finally {
        loginBtn.disabled = false;
    }
}

async function handleLogout() {
    try {
        await signOut(auth);
        // onAuthStateChanged detectará el cierre y logueará anónimamente
        // Volver al login
        showView('login-view');
    } catch (error) {
        console.error("Error al cerrar sesión:", error);
    }
}

// --- Lógica de Navegación ---
// Hacer showView global para que los botones HTML puedan llamarla
window.showView = (viewId) => {
    document.querySelectorAll('.view').forEach(view => {
        view.style.display = 'none';
    });
    
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
    }
    
    if (viewId === 'admin-view' && !adminMap) {
        initAdminMap();
        document.getElementById('prop-date').valueAsDate = new Date();
    }

    // Cuando se muestra el panel de Captador, asegurar que el botón esté habilitado para staff
    if (viewId === 'captador-view') {
        console.log('showView: entrando a captador-view, currentUser=', currentUser);
        const captBtn = document.getElementById('captador-submit-btn');
        const isAnonymous = currentUser ? !!currentUser.isAnonymous : true;
        const hasEmail = currentUser ? !!currentUser.email : false;
        console.log('showView: currentUser.isAnonymous=', isAnonymous, ' currentUser.email=', currentUser && currentUser.email);
        // Considerar staff si tiene email o no es anónimo
        if (currentUser && (!isAnonymous || hasEmail)) {
            if (captBtn) {
                captBtn.disabled = false;
                console.log('showView: captador-submit-btn habilitado (usuario staff detectado)');
            }
        } else {
            if (captBtn) {
                console.log('showView: usuario no es staff según chequeo, captador-submit-btn queda disabled');
                captBtn.disabled = true;
            }
        }
    }
    if (viewId === 'cliente-view') {
        if (!document.getElementById('client-filter-type')._listenersAttached) {
            document.getElementById('client-filter-type').addEventListener('change', renderClientProperties);
            document.getElementById('client-filter-class').addEventListener('change', renderClientProperties);
            document.getElementById('client-filter-barrio').addEventListener('change', renderClientProperties);
            document.getElementById('client-filter-type')._listenersAttached = true;
        }
    }
}

// --- Lógica de Mapas (Leaflet) ---
function initAdminMap() {
    try {
        const defaultCoords = [-31.4135, -64.1810]; // Córdoba
        adminMap = L.map('admin-map').setView(defaultCoords, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(adminMap);
        
        adminMarker = L.marker(defaultCoords, { draggable: true }).addTo(adminMap);
        
        adminMarker.on('dragend', (e) => updateMapInputs(e.target.getLatLng()));
        adminMap.on('click', (e) => {
            adminMarker.setLatLng(e.latlng);
            updateMapInputs(e.latlng);
        });

        updateMapInputs(adminMarker.getLatLng());
    } catch (e) {
        console.error("Error al inicializar el mapa de admin:", e);
        document.getElementById('admin-map').innerHTML = '<p class="text-red-500">Error al cargar el mapa.</p>';
    }
}

function updateMapInputs(latlng) {
    document.getElementById('map-lat').value = latlng.lat.toFixed(6);
    document.getElementById('map-lng').value = latlng.lng.toFixed(6);
}

function initDetailMap(lat, lng) {
    try {
        if (detailMap) {
            detailMap.remove();
        }
        
        const coords = [lat, lng];
        detailMap = L.map('detail-map').setView(coords, 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(detailMap);
        
        detailMarker = L.marker(coords).addTo(detailMap);
        
        // Arreglo para que el mapa se vea bien en el modal
        setTimeout(() => detailMap.invalidateSize(), 100); 

    } catch (e) {
        console.error("Error al inicializar el mapa de detalle:", e);
        document.getElementById('detail-map').innerHTML = '<p class="text-red-500">Error al cargar el mapa.</p>';
    }
}

// --- Lógica del Formulario del Captador ---
async function handleCaptadorSubmit(e) {
    e.preventDefault();
    console.log('handleCaptadorSubmit: iniciado', { userId, currentUser });
    const statusEl = document.getElementById('captador-form-status');
    const submitBtn = document.getElementById('captador-submit-btn');
    
    submitBtn.disabled = true;
    statusEl.innerText = "Guardando borrador...";
    statusEl.className = 'text-sm text-center text-blue-600';
    
    try {
        const propertyDraft = {
            owner: {
                name: document.getElementById('captador-form-owner').value,
                phone: document.getElementById('captador-form-phone').value,
                email: document.getElementById('captador-form-email').value,
            },
            address: {
                street: document.getElementById('captador-form-address').value,
                barrio: document.getElementById('captador-form-barrio').value
            },
            type: document.getElementById('captador-form-type').value,
            propertyClass: document.getElementById('captador-form-class').value,
            price: parseFloat(document.getElementById('captador-form-price').value) || 0,
            description: document.getElementById('captador-form-desc').value,
            status: 'pending', 
            captadorUploaderId: userId, // ID del staff logueado
            createdAt: Timestamp.now()
        };
        
        const docRef = await addDoc(propertiesCollection, propertyDraft);
        
        console.log("Borrador guardado con ID:", docRef.id);
        statusEl.innerText = "¡Guardado con Éxito!";
        statusEl.className = 'text-sm text-center text-green-600';
        e.target.reset();

        setTimeout(() => {
            statusEl.innerText = "";
            submitBtn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Error al guardar borrador:", error);
        console.error("Código de error:", error.code);
        console.error("Mensaje completo:", error.message);
        // Mostrar error de permisos si es el caso
        if (error.code === 'permission-denied' || error.code === 'failed-precondition') {
            statusEl.innerHTML = "<b>Error de Permisos.</b> Revise las 'Reglas' de Firestore. Código: " + error.code;
        } else {
            statusEl.innerText = `Error al guardar: ${error.message} (${error.code})`;
        }
        statusEl.className = 'text-sm text-center text-red-600';
        submitBtn.disabled = false;
    }
}

// --- Lógica de Administración (Pendientes) ---
function loadPendingProperties() {
    // Detener el listener anterior (si existe)
    unsubscribePending();
    
    const listEl = document.getElementById('pending-properties-list');
    const statusEl = document.getElementById('pending-status');
    
    // ¡¡¡LA CORRECCIÓN MÁS IMPORTANTE!!!
    // Ya no usamos 'where("status", "==", "pending")'
    // Esto evita el error de "índice faltante" y
    // permite que los botones se habiliten.
    const q = query(propertiesCollection);
    
    // Usamos onSnapshot para que se actualice en tiempo real
    unsubscribePending = onSnapshot(q, (snapshot) => {
        
        let pendingProps = [];
        snapshot.forEach(doc => {
            const prop = doc.data();
            if (prop.status === 'pending') { // Filtro en el cliente
                pendingProps.push({ id: doc.id, ...prop });
            }
        });

        if (pendingProps.length === 0) {
            statusEl.innerText = "No hay propiedades pendientes de revisión.";
            listEl.innerHTML = '';
        } else {
            statusEl.innerText = ""; // Limpiar "cargando"
            listEl.innerHTML = ''; // Limpiar lista vieja
        }
        
        // ¡¡¡LA SOLUCIÓN AL BOTÓN DESHABILITADO!!!
        // Habilitar botones de staff AHORA que cargaron los datos
        console.log("Carga de pendientes exitosa, habilitando botones.");
        document.getElementById('captador-submit-btn').disabled = false;
        document.getElementById('admin-submit-btn').disabled = false;
        document.getElementById('prop-files').disabled = false;
        
        pendingProps.forEach(propData => {
            const card = document.createElement('div');
            card.className = 'flex justify-between items-center bg-white p-3 rounded-lg shadow-sm border';
            card.innerHTML = `
                <div>
                    <p class="font-semibold">${propData.address?.street || 'Sin dirección'}</p>
                    <p class="text-sm text-slate-600">${propData.address?.barrio || 'Sin barrio'} - ${propData.type}</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-sm btn-primary" data-id="${propData.id}">Revisar</button>
                    <button class="btn btn-sm btn-danger" data-id="${propData.id}">Eliminar</button>
                </div>
            `;
            
            card.querySelector('.btn-primary').addEventListener('click', () => {
                loadPendingPropertyToForm(propData.id);
            });
            
            card.querySelector('.btn-danger').addEventListener('click', () => {
                propIdToDelete = propData.id;
                document.getElementById('delete-modal').style.display = 'flex';
            });

            listEl.appendChild(card);
        });
        
    }, (error) => {
        console.error("Error al cargar pendientes:", error);
        statusEl.innerText = "Error al cargar pendientes: " + error.message;
        statusEl.className = "text-red-600";
        if (error.code === 'permission-denied' || error.code === 'failed-precondition') {
            statusEl.innerHTML = "<b>Error de Permisos.</b> Revise las 'Reglas' de Firestore.";
        }
        
        // Habilitar botones de staff aunque haya error (para que puedan intentar guardar)
        // Esto es clave, por si el error es solo de 'list' pero 'create' sí funciona.
        console.warn("Error al cargar pendientes, pero habilitando botones de todas formas.");
        document.getElementById('captador-submit-btn').disabled = false;
        document.getElementById('admin-submit-btn').disabled = false;
        document.getElementById('prop-files').disabled = false;
    });
}

async function loadPendingPropertyToForm(id) {
    try {
        const docRef = doc(propertiesCollection, id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            alert("El documento ya no existe.");
            return;
        }
        
        const prop = docSnap.data();
        
        // Limpiar formulario antes de cargar
        clearAdminForm();
        
        document.getElementById('prop-id').value = id;
        document.getElementById('prop-type').value = prop.type || '';
        document.getElementById('prop-class').value = prop.propertyClass || '';
        
        document.getElementById('prop-owner').value = prop.owner?.name || '';
        document.getElementById('prop-phone').value = prop.owner?.phone || '';
        document.getElementById('prop-email').value = prop.owner?.email || '';

        document.getElementById('addr-street').value = prop.address?.street || '';
        document.getElementById('addr-barrio').value = prop.address?.barrio || '';
        document.getElementById('addr-num').value = prop.address?.num || '';
        document.getElementById('addr-floor').value = prop.address?.floor || '';
        document.getElementById('addr-depto').value = prop.address?.depto || '';
        document.getElementById('addr-tower').value = prop.address?.tower || '';
        document.getElementById('addr-manzana').value = prop.address?.manzana || '';
        document.getElementById('addr-lote').value = prop.address?.lote || '';
        document.getElementById('addr-extra').value = prop.address?.extra || '';
        
        document.getElementById('prop-price').value = prop.price || '';
        document.getElementById('prop-desc').value = prop.description || '';
        document.getElementById('prop-tasacion').value = prop.tasacion || '';
        if (prop.loadDate) {
            try { document.getElementById('prop-date').value = prop.loadDate; } catch(e){}
        }

        // Estado
        if (document.getElementById('prop-status')) {
            document.getElementById('prop-status').value = prop.status || 'published';
        }

        // Ubicación y coordenadas
        document.getElementById('map-lat').value = prop.location?.lat ?? '';
        document.getElementById('map-lng').value = prop.location?.lng ?? '';

        // Catastral
        document.getElementById('cat-distr').value = prop.catastral?.distr || '';
        document.getElementById('cat-circ').value = prop.catastral?.circ || '';
        document.getElementById('cat-zona').value = prop.catastral?.zona || '';
        document.getElementById('cat-manzana').value = prop.catastral?.manzana || '';
        document.getElementById('cat-lote').value = prop.catastral?.lote || '';
        document.getElementById('cat-ph').value = prop.catastral?.ph || '';

        // Servicios
        document.getElementById('serv-epec').value = prop.services?.epec || '';
        document.getElementById('serv-ecogas').value = prop.services?.ecogas || '';
        document.getElementById('serv-agua').value = prop.services?.agua || '';

        // Objetivos
        document.getElementById('obj-negocio').checked = !!prop.objectives?.negocio;
        document.getElementById('obj-viaje').checked = !!prop.objectives?.viaje;
        document.getElementById('obj-cambio').checked = !!prop.objectives?.cambio;
        document.getElementById('obj-otro-text').value = prop.objectives?.otro || '';

        // Imagenes - mostrar URLs si existen
        const previewEl = document.getElementById('file-list-preview');
        previewEl.innerHTML = '';
        if (prop.imageUrls && prop.imageUrls.length > 0) {
            const list = document.createElement('ul');
            list.className = 'list-disc list-inside';
            prop.imageUrls.forEach((url, idx) => {
                const li = document.createElement('li');
                li.innerHTML = `<a href="${url}" target="_blank" class="text-blue-600">Imagen ${idx+1}</a>`;
                list.appendChild(li);
            });
            previewEl.appendChild(list);
        }
        
        document.getElementById('admin-form-title').innerText = "Completando Borrador...";
        document.getElementById('admin-form-status').innerText = "Borrador cargado. Complete los campos restantes y publique.";
        document.getElementById('admin-form-status').className = 'text-sm text-center text-blue-600';
        
        window.scrollTo(0, document.getElementById('admin-form').offsetTop);

    } catch (error) {
        console.error("Error al cargar borrador en formulario:", error);
        alert("Error al cargar los datos: " + error.message);
    }
}

async function handleDeleteConfirm() {
    if (!propIdToDelete) return;

    const modal = document.getElementById('delete-modal');
    const confirmBtn = document.getElementById('delete-modal-confirm');
    
    confirmBtn.disabled = true;
    confirmBtn.innerText = "Eliminando...";

    try {
        const docRef = doc(propertiesCollection, propIdToDelete);
        await deleteDoc(docRef);
        
        console.log("Borrador eliminado:", propIdToDelete);
        modal.style.display = 'none';
        
    } catch (error) {
        console.error("Error al eliminar borrador:", error);
        alert("Error al eliminar: " + error.message);
    } finally {
        propIdToDelete = null;
        confirmBtn.disabled = false;
        confirmBtn.innerText = "Eliminar";
        modal.style.display = 'none';
    }
}

function clearAdminForm() {
    document.getElementById('admin-form').reset();
    document.getElementById('prop-id').value = '';
    document.getElementById('admin-form-title').innerText = "Cargar Nueva Propiedad";
    document.getElementById('admin-form-status').innerText = "";
    document.getElementById('file-list-preview').innerHTML = "";
    selectedFiles = [];
    if(adminMap && adminMarker) {
        const defaultCoords = [-31.4135, -64.1810];
        adminMarker.setLatLng(defaultCoords);
        adminMap.setView(defaultCoords, 13);
        updateMapInputs(adminMarker.getLatLng());
    }
    document.getElementById('prop-date').valueAsDate = new Date();
}

// --- Lógica de Administración (Publicar) ---

function handleFileSelection(e) {
    selectedFiles = Array.from(e.target.files).slice(0, 10);
    
    const previewEl = document.getElementById('file-list-preview');
    previewEl.innerHTML = '';
    
    if (selectedFiles.length === 0) return;
    
    previewEl.innerHTML = `<p>${selectedFiles.length} archivos seleccionados:</p>`;
    const list = document.createElement('ul');
    list.className = 'list-disc list-inside';
    selectedFiles.forEach((file, index) => {
        const item = document.createElement('li');
        item.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB) ${index === 0 ? '(Portada)' : ''}`;
        list.appendChild(item);
    });
    previewEl.appendChild(list);
}

async function handleAdminSubmit(e) {
    e.preventDefault();
    const statusEl = document.getElementById('admin-form-status');
    const submitBtn = document.getElementById('admin-submit-btn');
    const propId = document.getElementById('prop-id').value;

    submitBtn.disabled = true;
    statusEl.innerText = "Publicando propiedad... Esto puede tardar si hay fotos.";
    statusEl.className = 'text-sm text-center text-blue-600';
    
    try {
        // 1. Subir fotos
        const imageUrls = [];
        if (selectedFiles.length > 0) {
            statusEl.innerText = "Subiendo fotos (0%)...";
            
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                const uniqueName = `prop_${Date.now()}_${i}_${file.name}`;
                const storageRef = ref(storage, `properties/${uniqueName}`);
                
                await uploadBytes(storageRef, file);
                const url = await getDownloadURL(storageRef);
                imageUrls.push(url);
                
                statusEl.innerText = `Subiendo fotos (${Math.round(((i + 1) / selectedFiles.length) * 100)}%)...`;
            }
        }
        
        statusEl.innerText = "Guardando datos de la propiedad...";

        let captadorUploaderId = userId; // ID del staff logueado
        let createdAt = Timestamp.now();

        // Leer estado seleccionado por admin
        const selectedStatus = document.getElementById('prop-status') ? document.getElementById('prop-status').value : 'published';

        // CORRECCIÓN BUG: Si es un borrador, buscar sus datos originales
        let draftData = null;
        if (propId) {
            try {
                const docRef = doc(propertiesCollection, propId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    draftData = docSnap.data();
                    captadorUploaderId = draftData.captadorUploaderId || userId;
                    createdAt = draftData.createdAt || Timestamp.now();
                }
            } catch (getDocError) {
                console.warn("Error al buscar datos del borrador:", getDocError);
            }
        }

        // Si no se subieron fotos nuevas, preservar las existentes del borrador
        if (selectedFiles.length === 0 && draftData) {
            // mantener las imageUrls existentes
            var preservedImageUrls = draftData.imageUrls || [];
        }

        // 2. Recopilar todos los datos
        const propertyData = {
            status: selectedStatus || 'published',
            publishedAt: Timestamp.now(),
            createdAt: createdAt,
            captadorUploaderId: captadorUploaderId,
            adminPublisherId: userId,
            
            type: document.getElementById('prop-type').value,
            propertyClass: document.getElementById('prop-class').value,
            
            owner: {
                name: document.getElementById('prop-owner').value,
                phone: document.getElementById('prop-phone').value,
                email: document.getElementById('prop-email').value,
            },
            
            address: {
                street: document.getElementById('addr-street').value,
                num: document.getElementById('addr-num').value,
                barrio: document.getElementById('addr-barrio').value,
                floor: document.getElementById('addr-floor').value,
                depto: document.getElementById('addr-depto').value,
                tower: document.getElementById('addr-tower').value,
                manzana: document.getElementById('addr-manzana').value,
                lote: document.getElementById('addr-lote').value,
                extra: document.getElementById('addr-extra').value,
            },
            
            location: {
                lat: parseFloat(document.getElementById('map-lat').value),
                lng: parseFloat(document.getElementById('map-lng').value),
            },
            
            catastral: {
                distr: document.getElementById('cat-distr').value,
                circ: document.getElementById('cat-circ').value,
                zona: document.getElementById('cat-zona').value,
                manzana: document.getElementById('cat-manzana').value,
                lote: document.getElementById('cat-lote').value,
                ph: document.getElementById('cat-ph').value,
            },
            
            services: {
                epec: document.getElementById('serv-epec').value,
                ecogas: document.getElementById('serv-ecogas').value,
                agua: document.getElementById('serv-agua').value,
            },
            
            description: document.getElementById('prop-desc').value,
            price: parseFloat(document.getElementById('prop-price').value) || 0,
            tasacion: document.getElementById('prop-tasacion').value,
            loadDate: document.getElementById('prop-date').value,
            
            imageUrls: (imageUrls.length > 0) ? imageUrls : (preservedImageUrls || []),
            
            objectives: {
                negocio: document.getElementById('obj-negocio').checked,
                viaje: document.getElementById('obj-viaje').checked,
                cambio: document.getElementById('obj-cambio').checked,
                otro: document.getElementById('obj-otro-text').value,
            }
        };
        
        // 3. Guardar en Firestore
        if (propId) {
            // Actualizar el documento existente (el borrador)
            const docRef = doc(propertiesCollection, propId);
            await setDoc(docRef, propertyData);
            console.log("Propiedad actualizada (publicada):", propId);
        } else {
            // Crear un documento nuevo
            const docRef = await addDoc(propertiesCollection, propertyData);
            console.log("Propiedad nueva publicada:", docRef.id);
        }

        statusEl.innerText = "¡Propiedad Publicada con Éxito!";
        statusEl.className = 'text-sm text-center text-green-600';
        
        clearAdminForm();

        setTimeout(() => {
            statusEl.innerText = "";
            submitBtn.disabled = false;
        }, 3000);

    } catch (error) {
        console.error("Error al publicar propiedad:", error);
        if (error.code === 'permission-denied' || error.code === 'failed-precondition') {
            statusEl.innerHTML = "<b>Error de Permisos.</b> Revise las 'Reglas' de Storage en su Consola de Firebase.";
        } else {
            statusEl.innerText = "Error al publicar: " + error.message;
        }
        statusEl.className = 'text-sm text-center text-red-600';
        submitBtn.disabled = false;
    }
}

// --- Lógica de Vista de Cliente ---

function loadAndDisplayPublishedProperties() {
    unsubscribePublished();
    
    const statusEl = document.getElementById('client-status');
    statusEl.innerText = "Cargando propiedades...";
    
    // ¡¡¡LA CORRECCIÓN MÁS IMPORTANTE!!!
    // Ya no usamos 'where("status", "==", "published")'
    const q = query(propertiesCollection);
    
    unsubscribePublished = onSnapshot(q, (snapshot) => {
        allPublishedProperties = [];
        snapshot.forEach(doc => {
            const prop = doc.data();
            // Mostrar en cliente propiedades publicadas y también las marcadas como alquiladas o vendidas (con badge)
            if (['published', 'rented', 'sold'].includes(prop.status)) {
                allPublishedProperties.push({ id: doc.id, ...prop });
            }
        });
        
        renderClientProperties();
        
    }, (error) => {
        console.error("Error al cargar propiedades publicadas:", error);
        statusEl.innerText = "Error al cargar propiedades: " + error.message;
        statusEl.className = "text-red-600";
        if (error.code === 'permission-denied' || error.code === 'failed-precondition') {
            statusEl.innerHTML = "<b>Error de Permisos.</b> Revise las 'Reglas' de Firestore.";
        }
    });
}

function renderClientProperties() {
    const listEl = document.getElementById('client-property-list');
    const statusEl = document.getElementById('client-status');
    
    const filterType = document.getElementById('client-filter-type').value;
    const filterClass = document.getElementById('client-filter-class').value;
    const filterBarrio = document.getElementById('client-filter-barrio').value;

    const filteredProps = allPublishedProperties.filter(prop => {
        const matchesType = !filterType || prop.type === filterType;
        const matchesClass = !filterClass || prop.propertyClass === filterClass;
        const matchesBarrio = !filterBarrio || prop.address?.barrio === filterBarrio;
        return matchesType && matchesClass && matchesBarrio;
    });

    if (filteredProps.length === 0) {
        statusEl.innerText = "No se encontraron propiedades con esos filtros.";
        listEl.innerHTML = '';
        return;
    }
    
    statusEl.innerText = "";
    listEl.innerHTML = '';
    
    filteredProps.forEach(prop => {
        const card = document.createElement('div');
        card.className = 'client-card';
        const mainImage = prop.imageUrls?.[0] || 'https://placehold.co/600x400/e2e8f0/94a3b8?text=Propiedad';
        const statusBadge = (prop.status === 'rented') ? `<span class="absolute top-2 left-2 bg-yellow-500 text-white px-3 py-1 rounded font-semibold">ALQUILADO</span>` :
                            (prop.status === 'sold') ? `<span class="absolute top-2 left-2 bg-red-600 text-white px-3 py-1 rounded font-semibold">VENDIDO</span>` : '';

        card.innerHTML = `
            <div class="relative">
                ${statusBadge}
                <img src="${mainImage}" alt="Foto de ${prop.address?.street || 'propiedad'}" class="w-full h-48 object-cover" onerror="this.onerror=null;this.src='https://placehold.co/600x400/e2e8f0/94a3b8?text=Error+de+Foto';">
            </div>
            <div class="p-4">
                <p class="text-2xl font-bold text-blue-600">$${prop.price.toLocaleString('es-AR')}</p>
                <h3 class="text-xl font-semibold text-slate-900 mt-1">${prop.address?.street || 'Propiedad'}</h3>
                <p class="text-slate-600 mb-3">Barrio: ${prop.address?.barrio || 'No especificado'}</p>
                <div class="flex flex-wrap gap-2 mb-4">
                    <span class="text-sm font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded">${prop.type}</span>
                    <span class="text-sm font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">${prop.propertyClass}</span>
                </div>
                <button class="btn btn-primary w-full" data-id="${prop.id}">Ver Detalle</button>
            </div>
        `;
        
        card.querySelector('.btn-primary').addEventListener('click', () => {
            showPropertyDetail(prop.id);
        });
        
        listEl.appendChild(card);
    });
}

function loadBarriosList() {
    unsubscribeBarrios();
    const datalistEl = document.getElementById('barrios-list');
    const selectEl = document.getElementById('client-filter-barrio');
    
    // ¡¡SIN 'where'!!
    const q = query(propertiesCollection);
    
    unsubscribeBarrios = onSnapshot(q, (snapshot) => {
        const barrios = new Set();
        snapshot.forEach(doc => {
            const barrio = doc.data().address?.barrio;
            if (barrio) {
                barrios.add(barrio);
            }
        });
        
        // Limpiar listas anteriores
        datalistEl.innerHTML = '';
        // Preservar el "Barrio (Todos)"
        const currentSelection = selectEl.value;
        selectEl.innerHTML = '<option value="">Barrio (Todos)</option>'; 
        
        barrios.forEach(barrio => {
            const option = document.createElement('option');
            option.value = barrio;
            option.textContent = barrio;
            datalistEl.appendChild(option);
            selectEl.appendChild(option.cloneNode(true));
        });
        // Restaurar selección si aún existe
        selectEl.value = currentSelection;
        
    }, (error) => {
        console.error("Error al cargar lista de barrios:", error);
        if (error.code === 'permission-denied' || error.code === 'failed-precondition') {
            console.error("Error de permisos al cargar barrios. Revise reglas.");
        }
    });
}

async function showPropertyDetail(id) {
    try {
        const docRef = doc(propertiesCollection, id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            alert("Propiedad no encontrada.");
            return;
        }
        
        const prop = docSnap.data();
        
        // Rellenar datos
        document.getElementById('detail-title').innerText = prop.address?.street || 'Detalle';
        document.getElementById('detail-price').innerText = `$${prop.price.toLocaleString('es-AR')}`;
        document.getElementById('detail-type').innerText = prop.type;
        document.getElementById('detail-class').innerText = prop.propertyClass;
        document.getElementById('detail-barrio').innerText = prop.address?.barrio || 'N/A';
        document.getElementById('detail-desc').innerText = prop.description || 'No hay descripción disponible.';
        
        // Galería
        const mainImageEl = document.getElementById('detail-main-image');
        const galleryEl = document.getElementById('detail-thumbnail-gallery');
galleryEl.innerHTML = '';

        if (prop.imageUrls && prop.imageUrls.length > 0) {
            mainImageEl.src = prop.imageUrls[0];
            
            prop.imageUrls.forEach(url => {
                const img = document.createElement('img');
                img.src = url;
                img.className = 'w-20 h-20 object-cover rounded cursor-pointer border-2 border-transparent hover:border-blue-500';
                img.onclick = () => {
                    mainImageEl.src = url;
                };
                galleryEl.appendChild(img);
            });
            
        } else {
            mainImageEl.src = 'https://placehold.co/800x600/e2e8f0/94a3b8?text=Sin+Foto';
        }
        
        // Mostrar modal
        document.getElementById('detail-modal').style.display = 'flex';
        
        // Inicializar mapa (con un pequeño delay para que el modal sea visible)
        const lat = prop.location?.lat || -31.4135;
        const lng = prop.location?.lng || -64.1810;
        setTimeout(() => initDetailMap(lat, lng), 50);

    } catch (error) {
        console.error("Error al mostrar detalle:", error);
        alert("Error al cargar los detalles: " + error.message);
    }
}

// --- Iniciar la App ---
initializeMainApp();