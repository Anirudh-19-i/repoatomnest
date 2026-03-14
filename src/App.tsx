import React, { useState, useEffect, useRef, Component } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  setDoc, 
  getDocs,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User, signInWithPopup, signOut } from 'firebase/auth';
import { auth, db, googleProvider } from './firebase';
import { Product, CartItem, Order, PaymentMethod } from './types';
import { GeminiLiveService } from './services/geminiLiveService';
import { audioFeedback } from './services/audioFeedbackService';
import { 
  ShoppingCart, 
  Mic, 
  Search, 
  Package, 
  LogOut, 
  LogIn, 
  Trash2, 
  Plus, 
  Minus,
  CheckCircle2,
  XCircle,
  ShoppingBag,
  CreditCard,
  ChevronRight,
  Camera,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error && parsed.error.includes("permission-denied")) {
          message = "You don't have permission to perform this action. Please make sure you're signed in.";
        }
      } catch (e) {
        // Not a JSON error
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
          <div className="bg-white p-8 rounded-[32px] shadow-xl max-w-md w-full text-center">
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Application Error</h2>
            <p className="text-[var(--tx-1)]/60 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-[var(--accent)] text-white rounded-full font-bold"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAssistantGenerating, setIsAssistantGenerating] = useState(false);
  const [assistantText, setAssistantText] = useState("Try saying \"Search for wireless headphones\" or \"What's in my cart?\" to get started.");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showCart, setShowCart] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successTxn, setSuccessTxn] = useState("");
  const [screenShield, setScreenShield] = useState(false);
  const [isBiometricAuthActive, setIsBiometricAuthActive] = useState(false);
  const [biometricStep, setBiometricStep] = useState<'idle' | 'face' | 'voice' | 'success'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveService = useRef<GeminiLiveService | null>(null);
  const handleToolCallRef = useRef<any>(null);

  useEffect(() => {
    handleToolCallRef.current = handleToolCall;
  });

  // Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const userRef = doc(db, 'users', u.uid);
          await setDoc(userRef, {
            displayName: u.displayName,
            email: u.email,
            photoURL: u.photoURL,
            role: 'user'
          }, { merge: true });
        } catch (error) {
          console.error("Error syncing user profile:", error);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Products Listener
  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(productsData);
      if (snapshot.empty) seedInitialProducts();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });
    return () => unsubscribe();
  }, []);

  const seedInitialProducts = async () => {
    const initialProducts = [
      { name: 'Wireless Headphones', description: 'Premium noise-cancelling with 30hr battery, deep bass', price: 2999, category: 'Electronics', stock: 12, emoji: '🎧' },
      { name: 'Organic Whole Milk 1L', description: 'Farm-fresh pasteurized full-cream milk', price: 68, category: 'Dairy', stock: 40, emoji: '🥛' },
      { name: 'Sourdough Loaf', description: 'Artisan slow-fermented, crisp crust', price: 149, category: 'Bakery', stock: 8, emoji: '🍞' },
      { name: 'Alphonso Mangoes (6pcs)', description: 'Premium GI-tagged Ratnagiri mangoes', price: 499, category: 'Fruits', stock: 20, emoji: '🥭' },
      { name: 'Cold Brew Coffee 300ml', description: 'Single-origin dark roast, 18-hour steep', price: 189, category: 'Beverages', stock: 25, emoji: '☕' },
      { name: 'Bluetooth Speaker', description: 'Waterproof IPX7, 360° surround, 12hr play', price: 1499, category: 'Electronics', stock: 15, emoji: '🔊' },
      { name: 'Basmati Rice 5kg', description: 'Aged Pusa 1121 long-grain basmati', price: 399, category: 'Grocery', stock: 30, emoji: '🍚' },
      { name: 'Greek Yoghurt 400g', description: 'Thick & creamy, live cultures, no sugar', price: 129, category: 'Dairy', stock: 18, emoji: '🍦' },
      { name: 'Green Tea 100g', description: 'Organic first-flush Darjeeling leaves', price: 249, category: 'Beverages', stock: 50, emoji: '🍵' },
      { name: 'Banana Bunch', description: 'Cavendish, ripe & sweet, farm direct', price: 49, category: 'Fruits', stock: 60, emoji: '🍌' },
      { name: 'Smart Watch', description: 'Health monitoring, GPS, 7-day battery', price: 3499, category: 'Electronics', stock: 7, emoji: '⌚' },
      { name: 'Sunscreen SPF50', description: 'Broad-spectrum UVA/UVB, lightweight gel', price: 349, category: 'Grocery', stock: 35, emoji: '🧴' },
    ];
    for (const p of initialProducts) {
      await addDoc(collection(db, 'products'), p);
    }
  };

  // Cart Listener
  useEffect(() => {
    if (!user) {
      setCart([]);
      return;
    }
    const q = query(collection(db, `users/${user.uid}/cart`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cartData = snapshot.docs.map(doc => ({ productId: doc.id, ...doc.data() } as CartItem));
      setCart(cartData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/cart`);
    });
    return () => unsubscribe();
  }, [user]);

  // Orders Listener
  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }
    const q = query(collection(db, 'orders'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      setOrders(ordersData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });
    return () => unsubscribe();
  }, [user]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  const toggleLive = async () => {
    if (isLive) {
      liveService.current?.disconnect();
      setIsLive(false);
      setIsUserSpeaking(false);
      setIsAssistantGenerating(false);
      setAssistantText("Try saying \"Search for wireless headphones\" or \"What's in my cart?\" to get started.");
    } else {
      if (!liveService.current) {
        liveService.current = new GeminiLiveService();
      }
      setIsLive(true);
      await liveService.current.connect({
        onMessage: (text) => {
          setAssistantText(text);
          setIsAssistantGenerating(false);
        },
        onResponseStarted: () => {
          setIsAssistantGenerating(false);
        },
        onInterrupted: () => {
          setAssistantText("");
          setIsAssistantGenerating(false);
        },
        onToolCall: (call: any) => handleToolCallRef.current?.(call),
        onUserSpeaking: (speaking) => {
          setIsUserSpeaking(speaking);
          if (!speaking) setIsAssistantGenerating(true);
          else setIsAssistantGenerating(false);
        }
      });
    }
  };

  const handleToolCall = async (toolCall: { name: string; args: any }) => {
    if (!user) return { error: "User not authenticated" };

    try {
      switch (toolCall.name) {
        case 'searchProducts': {
          const { query: q } = toolCall.args;
          setSearchQuery(q);
          audioFeedback.action();
          const filtered = products.filter(p => 
            p.name.toLowerCase().includes(q.toLowerCase()) || 
            p.category.toLowerCase().includes(q.toLowerCase())
          );
          return { products: filtered };
        }

        case 'stopConversation': {
          setIsLive(false);
          setScreenShield(false);
          liveService.current?.disconnect();
          liveService.current = null;
          audioFeedback.notification();
          return { success: true, message: "Conversation ended." };
        }

        case 'togglePrivacyShield': {
          setScreenShield(prev => !prev);
          audioFeedback.action();
          return { success: true, shieldActive: !screenShield };
        }

        case 'addToCart': {
          const { productId, quantity, productName } = toolCall.args;
          let product = products.find(p => p.id === productId);
          if (!product && productName) {
            product = products.find(p => p.name.toLowerCase().includes(productName.toLowerCase()));
          }
          if (!product) return { error: "Product not found." };

          const cartRef = doc(db, `users/${user.uid}/cart`, product.id);
          const existingItem = cart.find(item => item.productId === product!.id);
          
          if (existingItem) {
            await updateDoc(cartRef, { quantity: existingItem.quantity + (quantity || 1) });
          } else {
            await setDoc(cartRef, {
              productId: product.id,
              name: product.name,
              price: product.price,
              quantity: quantity || 1,
              emoji: product.emoji
            });
          }
          audioFeedback.success();
          showToast(`🛒 ${product.name} added!`);
          return { success: true, message: `Added ${product.name} to cart` };
        }

        case 'getCart': {
          return { 
            items: cart.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
            total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
          };
        }

        case 'placeOrder': {
          if (cart.length === 0) return { error: "Cart is empty" };
          setIsBiometricAuthActive(true);
          setBiometricStep('face');
          audioFeedback.notification();
          return { success: true, requiresAuth: true };
        }

        case 'confirmBiometricAuth': {
          setBiometricStep('success');
          audioFeedback.success();
          
          setTimeout(async () => {
            const totalPrice = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const orderData = {
              userId: user.uid,
              items: cart,
              totalPrice: totalPrice + Math.round(totalPrice * 0.05),
              status: 'pending',
              paymentMethod: 'UPI',
              createdAt: serverTimestamp()
            };

            const orderRef = await addDoc(collection(db, 'orders'), orderData);
            setSuccessTxn(`TXN#VAOM-${orderRef.id.slice(0, 8).toUpperCase()}`);
            
            const cartDocs = await getDocs(collection(db, `users/${user.uid}/cart`));
            for (const d of cartDocs.docs) await deleteDoc(d.ref);
            
            setIsBiometricAuthActive(false);
            setBiometricStep('idle');
            setShowSuccess(true);
            audioFeedback.notification();

            setTimeout(() => {
              setIsLive(false);
              liveService.current?.disconnect();
              liveService.current = null;
            }, 1500);
          }, 2000);

          return { success: true };
        }

        case 'trackOrder': {
          const { orderId } = toolCall.args;
          const order = orders.find(o => o.id === orderId);
          if (!order) return { error: "Order not found." };
          return { status: order.status, total: order.totalPrice };
        }

        case 'cancelOrder': {
          const { orderId } = toolCall.args;
          const order = orders.find(o => o.id === orderId);
          if (!order || order.status !== 'pending') return { error: "Cannot cancel." };
          await updateDoc(doc(db, 'orders', orderId), { status: 'cancelled' });
          audioFeedback.action();
          return { success: true };
        }

        default:
          return { error: "Unknown tool" };
      }
    } catch (error) {
      return { error: "Failed to execute command" };
    }
  };

  const addToCartManual = (p: Product) => {
    if (!user) { setShowLogin(true); return; }
    handleToolCall({ name: 'addToCart', args: { productId: p.id, quantity: 1 } });
  };

  const updateCartQty = async (id: string, delta: number) => {
    if (!user) return;
    const item = cart.find(i => i.productId === id);
    if (!item) return;
    const newQty = item.quantity + delta;
    const ref = doc(db, `users/${user.uid}/cart`, id);
    if (newQty <= 0) await deleteDoc(ref);
    else await updateDoc(ref, { quantity: newQty });
    audioFeedback.action();
  };

  const cancelOrderManual = async (id: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'orders', id), { status: 'cancelled' });
    audioFeedback.action();
    showToast("Order cancelled.");
  };

  // Biometric Camera Effect
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectionTimeout: any;

    const startCamera = async () => {
      if (isBiometricAuthActive && biometricStep === 'face') {
        try {
          setCameraError(null);
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!videoRef.current) return;
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            await videoRef.current.play();
          }
          detectionTimeout = setTimeout(() => {
            setBiometricStep('voice');
            audioFeedback.action();
          }, 4000);
        } catch (err: any) {
          setCameraError(err.name === 'NotAllowedError' ? "Permission denied" : "Could not access camera");
        }
      }
    };

    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (detectionTimeout) clearTimeout(detectionTimeout);
    };
  }, [isBiometricAuthActive, biometricStep]);

  const cartSubtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartTax = Math.round(cartSubtotal * 0.05);
  const cartTotal = cartSubtotal + cartTax;

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === "All" || p.category === selectedCategory;
    const matchesSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  };

  const handleLogin = () => signInWithPopup(auth, googleProvider).then(() => setShowLogin(false));

  return (
    <ErrorBoundary>
      <div className="wrap">
        {/* Background Scene */}
        <div className="scene">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="orb orb-4" />
          <div className="orb orb-5" />
        </div>
        <div className="dot-grid fixed inset-0 z-1 pointer-events-none" />

        {/* Header */}
        <header>
          <div className="container">
            <div className="hdr-inner">
              <a className="logo" href="#">
                <div className="logo-mark">🛒</div>
                <div className="logo-text">AI-<span>VAOM</span></div>
              </a>
              <div className="search-bar">
                <Search size={17} strokeWidth={2.5} />
                <input 
                  type="text" 
                  placeholder="Search products by name or category…" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="hdr-actions">
                {!user ? (
                  <button className="sign-in-btn" onClick={() => setShowLogin(true)}>
                    <LogIn size={15} strokeWidth={2.5} className="mr-2" />
                    Sign In
                  </button>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <button className="btn-ghost" onClick={() => setShowOrders(true)}>
                      <Package size={15} strokeWidth={2.5} className="mr-1.5" />
                      Orders
                    </button>
                    <button className="btn-cart" onClick={() => setShowCart(true)}>
                      <ShoppingCart size={15} strokeWidth={2.5} className="mr-1.5" />
                      Cart
                      {cart.length > 0 && (
                        <div className="cart-badge">{cart.reduce((s, i) => s + i.quantity, 0)}</div>
                      )}
                    </button>
                    <div className="sep" />
                    <img className="avatar" src={user.photoURL || `https://api.dicebear.com/9.x/micah/svg?seed=${user.uid}`} alt="User" />
                    <button className="btn-icon" onClick={() => signOut(auth)} title="Sign out">
                      <LogOut size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main>
          <div className="container">
            {/* Hero Section */}
            <section className="hero">
              <div className="hero-grid">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                  <div className="hero-eyebrow"><span>🎙️</span> AI-Driven Voice Shopping</div>
                  <h1 className="hero-title">Shop smarter<br />with your <em>Voice.</em></h1>
                  <p className="hero-desc">Experience the future of accessible shopping. Talk to our Gemini-powered AI assistant to search products, manage your cart, and place orders — completely hands-free.</p>
                  
                  <div className="voice-cta">
                    <button 
                      className={cn("btn-voice", isLive && "live")} 
                      onClick={toggleLive}
                    >
                      <Mic size={20} strokeWidth={2.5} />
                      <span>{isLive ? "Stop Listening" : "Start Voice Assistant"}</span>
                      {isLive && <div className="live-dot" />}
                    </button>
                    
                    {isLive && (
                      <div className="voice-waves">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className={cn("vw", isUserSpeaking && "speaking")} style={{ animationDelay: `${i * 0.1}s` }} />
                        ))}
                        <span className="voice-status">{isUserSpeaking ? "Listening…" : isAssistantGenerating ? "Processing…" : "Waiting…"}</span>
                      </div>
                    )}
                  </div>

                  <div className="feature-chips">
                    <div className="chip"><div className="chip-dot" />Gemini Live API</div>
                    <div className="chip"><div className="chip-dot" />Firebase Realtime</div>
                    <div className="chip"><div className="chip-dot" />Voice + Biometric Auth</div>
                    <div className="chip"><div className="chip-dot" />Screen Reader Ready</div>
                  </div>
                </motion.div>

                <motion.div 
                  className="assistant-card-wrap"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <div className="assistant-card">
                    <div className="flex items-start gap-4">
                      <div className={cn("ai-avatar", isAssistantGenerating && "pulse")}>🤖</div>
                      <div className="flex-1 relative z-1">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="ai-label">AI Assistant — VAOM</div>
                          {isAssistantGenerating && <div className="ai-processing">Processing…</div>}
                        </div>
                        <div className="ai-text">
                          {assistantText.split(' ').map((word, i) => (
                            word.startsWith('"') ? <em key={i} className="text-[var(--accent)] not-italic">{word} </em> : word + ' '
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-[22px] pt-[18px] border-t border-[var(--gb-1)] relative z-1">
                      <div className="text-[10px] font-bold text-[var(--tx-3)] uppercase tracking-[1.5px] mb-[13px]">Quick voice commands</div>
                      <div className="flex flex-wrap gap-2">
                        {["Search headphones", "Add to cart", "Place my order", "Track my order"].map(cmd => (
                          <span key={cmd} className="qcmd" onClick={() => handleToolCall({ name: 'searchProducts', args: { query: cmd.split(' ').pop() } })}>"{cmd}"</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Quick Commands */}
            <section className="section">
              <div className="section-head"><div className="section-title">What can you say?</div></div>
              <div className="commands-grid">
                {[
                  { icon: '🔍', label: 'Search', text: 'Search for organic tea', key: 'search' },
                  { icon: '🛒', label: 'Add to cart', text: 'Add 2 bottles of milk', key: 'add' },
                  { icon: '📦', label: 'Place order', text: 'Place my order via UPI', key: 'order' },
                  { icon: '🚚', label: 'Track order', text: 'Where is my last order?', key: 'track' },
                  { icon: '❌', label: 'Cancel order', text: 'Cancel order #AB1234', key: 'cancel' },
                  { icon: '💡', label: 'Recommend', text: 'Suggest a gift under ₹500', key: 'recommend' },
                ].map(cmd => (
                  <div key={cmd.key} className="cmd-card" onClick={() => speak(`Try saying: ${cmd.text}`)}>
                    <div className="cmd-icon">{cmd.icon}</div>
                    <div>
                      <div className="cmd-say">{cmd.label}</div>
                      <div className="cmd-text">"{cmd.text}"</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Products Section */}
            <section className="section">
              <div className="section-head">
                <div className="section-title">Featured Products</div>
                <div className="cat-pills">
                  {["All", "Dairy", "Bakery", "Fruits", "Beverages", "Electronics", "Grocery"].map(cat => (
                    <div 
                      key={cat} 
                      className={cn("cat-pill", selectedCategory === cat && "active")}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </div>
                  ))}
                </div>
              </div>
              <div className="products-grid">
                {filteredProducts.map(p => (
                  <div key={p.id} className="product-card" onClick={() => speak(`${p.name}. ${p.description}. Price: ₹${p.price}.`)}>
                    <div className="prod-img">
                      <div className="prod-img-placeholder">{p.emoji}</div>
                      <div className="cat-tag">{p.category}</div>
                      {p.stock < 10 && <div className="stock-low">Only {p.stock} left</div>}
                    </div>
                    <div className="prod-body">
                      <div className="prod-name">{p.name}</div>
                      <div className="prod-desc">{p.description}</div>
                      <div className="prod-foot">
                        <div className="prod-price">₹{p.price.toLocaleString('en-IN')}</div>
                        <button 
                          className="add-btn" 
                          onClick={(e) => { e.stopPropagation(); addToCartManual(p); }}
                        >
                          <Plus size={18} strokeWidth={3} color="white" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        {/* Footer */}
        <footer>
          <div className="container">
            <div className="footer-grid">
              <div className="footer-brand">
                <div className="logo">
                  <div className="logo-mark w-[38px] h-[38px] text-[18px]">🛒</div>
                  <div className="logo-text text-[18px]">AI-<span>VAOM</span></div>
                </div>
                <p className="footer-desc">The AI-Driven Voice Activated Intelligent Order Management system. Built for accessibility, speed, and a smarter shopping experience powered by Gemini Live API.</p>
              </div>
              <div>
                <div className="footer-col-title">Quick Links</div>
                <ul className="footer-links">
                  <li><a href="#">Shop All</a></li>
                  <li><a href="#">Voice Guide</a></li>
                  <li><a href="#">Accessibility</a></li>
                  <li><a href="#">API Docs</a></li>
                </ul>
              </div>
              <div>
                <div className="footer-col-title">Support</div>
                <ul className="footer-links">
                  <li><a href="#">Help Center</a></li>
                  <li><a href="#">Shipping Info</a></li>
                  <li><a href="#">Returns</a></li>
                  <li><a href="#">Contact Us</a></li>
                </ul>
              </div>
            </div>
            <div className="footer-bottom">
              <div className="footer-copy">© 2026 AI-VAOM. All rights reserved.</div>
              <div className="footer-legal">
                <a href="#">Privacy Policy</a>
                <a href="#">Terms of Service</a>
              </div>
            </div>
          </div>
        </footer>

        {/* Overlays & Modals */}
        <AnimatePresence>
          {toastMsg && (
            <motion.div 
              initial={{ opacity: 0, y: 20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 20, x: '-50%' }}
              className="toast show"
            >
              {toastMsg}
            </motion.div>
          )}

          {(showCart || showOrders) && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="overlay show" 
              onClick={() => { setShowCart(false); setShowOrders(false); }} 
            />
          )}

          {/* Cart Panel */}
          {showCart && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="sidepanel show"
            >
              <div className="panel-hdr">
                <div className="panel-title">Your Cart</div>
                <button className="close-btn" onClick={() => setShowCart(false)}>
                  <XCircle size={17} strokeWidth={2.5} />
                </button>
              </div>
              <div className="panel-body">
                {cart.length === 0 ? (
                  <div className="cart-empty">
                    <div className="cart-empty-icon">🛒</div>
                    <div className="text-[16px] font-bold text-[var(--tx-2)]">Your cart is empty</div>
                    <div className="mt-2 text-[13px] text-[var(--tx-3)]">Browse products or use voice to add items</div>
                  </div>
                ) : (
                  cart.map(item => (
                    <div key={item.productId} className="cart-item">
                      <div className="ci-thumb">{item.emoji}</div>
                      <div className="ci-info">
                        <div className="ci-name">{item.name}</div>
                        <div className="ci-price">₹{item.price} × {item.quantity} = ₹{item.price * item.quantity}</div>
                      </div>
                      <div className="qty-ctrl">
                        <button className="qty-btn" onClick={() => updateCartQty(item.productId, -1)}>−</button>
                        <div className="qty-num">{item.quantity}</div>
                        <button className="qty-btn" onClick={() => updateCartQty(item.productId, 1)}>+</button>
                      </div>
                      <button className="ci-remove" onClick={() => updateCartQty(item.productId, -item.quantity)}>
                        <Trash2 size={14} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              {cart.length > 0 && (
                <div className="panel-footer">
                  <div className="totals-box">
                    <div className="tot-row"><span className="tot-label">Subtotal</span><span>₹{cartSubtotal}</span></div>
                    <div className="tot-row"><span className="tot-label">GST (5%)</span><span>₹{cartTax}</span></div>
                    <div className="tot-row grand"><span className="tot-label grand">Total</span><span className="tot-val grand">₹{cartTotal}</span></div>
                  </div>
                  <button className="checkout-btn" onClick={() => handleToolCall({ name: 'placeOrder', args: { paymentMethod: 'saved' } })}>
                    <CreditCard size={18} strokeWidth={2.5} />
                    Secure Checkout
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* Orders Panel */}
          {showOrders && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="sidepanel show"
            >
              <div className="panel-hdr">
                <div className="panel-title">Order History</div>
                <button className="close-btn" onClick={() => setShowOrders(false)}>
                  <XCircle size={17} strokeWidth={2.5} />
                </button>
              </div>
              <div className="panel-body">
                {orders.length === 0 ? (
                  <div className="cart-empty">
                    <div className="cart-empty-icon">📦</div>
                    <div className="text-[16px] font-bold text-[var(--tx-2)]">No orders yet</div>
                  </div>
                ) : (
                  orders.map(o => (
                    <div key={o.id} className="order-card">
                      <div className="order-head">
                        <div className="order-id">Order #{o.id.slice(0, 8).toUpperCase()}</div>
                        <div className={cn("status-badge", `status-${o.status}`)}>
                          {o.status === 'pending' ? '⏳' : o.status === 'shipped' ? '🚚' : o.status === 'delivered' ? '✅' : '❌'} {o.status}
                        </div>
                      </div>
                      <div className="order-items">
                        {o.items.map((i, idx) => (
                          <div key={idx} className="order-item-row">
                            <span>{i.name} × {i.quantity}</span>
                            <span>₹{i.price * i.quantity}</span>
                          </div>
                        ))}
                      </div>
                      <div className="order-foot">
                        <div>
                          <div className="text-[11px] text-[var(--tx-3)] mb-[3px]">Payment: {o.paymentMethod}</div>
                          <div className="order-total">₹{o.totalPrice}</div>
                        </div>
                        {o.status === 'pending' && (
                          <button className="cancel-btn" onClick={() => cancelOrderManual(o.id)}>Cancel</button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {/* Biometric Auth Modal */}
          {isBiometricAuthActive && (
            <div className="modal-wrap show">
              <div className="auth-modal">
                <button className="close-btn absolute top-4 right-4" onClick={() => setIsBiometricAuthActive(false)}>
                  <XCircle size={17} strokeWidth={2.5} />
                </button>
                <div className="font-head text-[22px] font-extrabold mb-6 text-[var(--tx-1)]">Biometric Verification</div>
                <div className="auth-steps">
                  {[
                    { n: 1, lbl: 'Face ID', step: 'face' },
                    { n: 2, lbl: 'Voice', step: 'voice' },
                    { n: 3, lbl: 'Confirm', step: 'success' }
                  ].map(s => (
                    <div key={s.n} className={cn("auth-step", (biometricStep === s.step || (s.n === 1 && biometricStep === 'face') || (s.n === 2 && biometricStep === 'voice') || (s.n === 3 && biometricStep === 'success')) ? "active" : "")}>
                      <div className="step-dot">{s.n}</div>
                      <div className="step-lbl">{s.lbl}</div>
                    </div>
                  ))}
                </div>
                
                <div id="auth-body">
                  {biometricStep === 'face' ? (
                    <>
                      <p className="text-[13px] text-[var(--tx-2)] mb-4 leading-[1.7]">Keep your face steady in front of the camera. The scan takes about 3 seconds.</p>
                      <div className="cam-box">
                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                        <div className="face-scan on">
                          <div className="scan-box">
                            <div className="scan-ln" />
                            <div className="sc tl" /><div className="sc tr" /><div className="sc bl" /><div className="sc br" />
                          </div>
                        </div>
                      </div>
                      <button className="auth-action cam" onClick={() => setBiometricStep('voice')}>
                        <Camera size={18} className="mr-2" />
                        Next: Voice ID
                      </button>
                    </>
                  ) : biometricStep === 'voice' ? (
                    <>
                      <p className="text-[13px] text-[var(--tx-2)] mb-4 leading-[1.7]">Read the passphrase aloud, one word at a time.</p>
                      <div className="pp-box">
                        <div className="pp-lbl">Say these three words</div>
                        <div className="pp-words">
                          <div className="word lit">Sunrise</div>
                          <div className="word">Seven</div>
                          <div className="word">Delta</div>
                        </div>
                      </div>
                      <button className="auth-action mic" onClick={() => handleToolCall({ name: 'confirmBiometricAuth', args: {} })}>
                        <Mic size={18} className="mr-2" />
                        Begin Voice Check
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center py-8">
                      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                        <Check className="w-10 h-10 text-emerald-600" />
                      </div>
                      <h3 className="text-xl font-bold">Identity Verified</h3>
                      <p className="text-[var(--tx-2)]">Processing your payment securely...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Success Modal */}
          {showSuccess && (
            <div className="modal-wrap show">
              <div className="modal">
                <div className="modal-icon">✓</div>
                <div className="modal-title">Order Placed!</div>
                <div className="modal-sub">Your payment was processed securely with biometric verification. You'll receive updates via SMS and email.</div>
                <div className="txn-id">{successTxn}</div>
                <button className="checkout-btn max-w-[220px] mx-auto" onClick={() => setShowSuccess(false)}>Continue Shopping</button>
              </div>
            </div>
          )}

          {/* Login Modal */}
          {showLogin && (
            <div className="modal-wrap show">
              <div className="login-modal">
                <button className="close-btn absolute top-4 right-4" onClick={() => setShowLogin(false)}>
                  <XCircle size={17} strokeWidth={2.5} />
                </button>
                <div className="text-[36px] mb-3.5">🌸</div>
                <div className="font-head text-[24px] font-extrabold mb-2 text-[var(--tx-1)]">Welcome to AI-VAOM</div>
                <div className="text-[14px] text-[var(--tx-2)] leading-[1.7]">Sign in to save your cart, place orders, and track your purchases.</div>
                <button className="google-btn" onClick={handleLogin}>
                  <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </button>
                <div className="mt-3.5 text-[11px] text-[var(--tx-3)]">By signing in, you agree to our Terms of Service and Privacy Policy.</div>
              </div>
            </div>
          )}

          {/* Privacy Shield */}
          {screenShield && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#141414] z-[100] flex flex-col items-center justify-center text-center p-8"
            >
              <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center mb-8 animate-pulse">
                <Mic className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-3xl font-black text-white mb-4">Privacy Shield Active</h2>
              <p className="text-white/60 max-w-md text-lg mb-12">
                Your screen is hidden to protect your privacy while you use voice commands. 
                I am still listening.
              </p>
              <button 
                onClick={() => setScreenShield(false)}
                className="px-8 py-4 bg-white text-[#141414] rounded-full font-bold text-lg shadow-2xl hover:bg-white/90 transition-all"
              >
                Disable Shield
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
