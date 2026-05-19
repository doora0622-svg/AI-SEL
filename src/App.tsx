/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Book, 
  Heart, 
  Search, 
  User, 
  Settings, 
  Plus, 
  Trash2, 
  Edit, 
  ChevronLeft, 
  ChevronDown,
  ChevronUp,
  Play, 
  FileText, 
  Youtube, 
  Video, 
  CheckCircle, 
  Award, 
  LogOut,
  Star,
  Filter,
  X,
  Lock,
  Sparkles,
  Loader2,
  LogIn,
  AlertTriangle,
  FileSpreadsheet,
  FileQuestion,
  Check,
  MessageCircle,
  Save,
  Download,
  Home,
  Lightbulb,
  BookOpen,
  RotateCcw,
  ExternalLink,
  Maximize,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { GoogleGenerativeAI } from "@google/generative-ai";
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc, 
  writeBatch,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth, loginWithGoogle, loginAnonymously, logout as firebaseLogout } from './lib/firebase';

// Initialize AI if key is available
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// --- Types ---

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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

interface BookData {
  id: string;
  title: string;
  author: string;
  description: string;
  coverImageUrl: string;
  type: 'pdf' | 'youtube' | 'video' | 'text';
  fileData: string; // base64, youtubeId, or text content
  keywords: string[];
  createdAt: number;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  hint?: string;
  type?: 'content' | 'sel';
  selIndicatorId?: string; // Links to code in sel_indicators
  optionSels?: string[];   // For SEL type: specific info per option
  optionScores?: number[]; // For SEL type: score per option
}

interface UserData {
  nickname: string;
  favoriteBookIds: string[];
  passedBookIds: string[];
  readingProgress: { [bookId: string]: any };
  selFeedback?: {
    [bookId: string]: {
      score: number;
      responses: any[];
      feedback: string;
      dimensions: { [dim: string]: number };
      date: number;
    }
  };
}

interface SELIndicator {
  id?: string;
  dimension: string;
  code: string;
  subDomain: string;
  description: string;
  weight: string;
}

const INITIAL_SEL_INDICATORS: SELIndicator[] = [
  { dimension: "第一維度：自我覺察", code: "1-1-1", subDomain: "情緒顆粒度 (命名)", description: "能精確辨識並命名「委屈、焦慮、尷尬」等複雜情緒，而非僅用好/壞描述。", weight: "7%" },
  { dimension: "第一維度：自我覺察", code: "1-1-2", subDomain: "身心連結覺察", description: "能察覺情緒引發的生理反應（如：緊張時心跳快、難過時胸口悶）。", weight: "6%" },
  { dimension: "第一維度：自我覺察", code: "1-2-1", subDomain: "自我效能感", description: "面對具挑戰性的學習任務時，具備「我可以透過練習變強」的成長心態。", weight: "7%" },
  { dimension: "第一維度：自我覺察", code: "1-3-1", subDomain: "優勢與限制辨識", description: "能具體說出自己的強項（特長）與需要支持的地方（弱項），不卑不亢。", weight: "5%" },
  { dimension: "第一維度：自我覺察", code: "1-3-2", subDomain: "文化與認同感", description: "理解並認同自己的家庭背景與興趣，展現健康的自我形象與自信。", weight: "5%" },
  { dimension: "第二維度：自我管理", code: "2-1-1", subDomain: "即時冷靜技術", description: "情緒激動時，能自主運用如「深呼吸、數到十」等生理調節工具。", weight: "8%" },
  { dimension: "第二維度：自我管理", code: "2-1-2", subDomain: "壓力應對彈性", description: "面對考驗或競賽壓力，能維持情緒平穩，不因過度焦慮而放棄或失常。", weight: "6%" },
  { dimension: "第二維度：自我管理", code: "2-2-1", subDomain: "衝動制動能力", description: "在做出反應前能有「思考間隙」，抑制想口出惡言或動手搶奪的衝動。", weight: "7%" },
  { dimension: "第二維度：自我管理", code: "2-3-1", subDomain: "目標拆解與執行", description: "能將大任務（如長假作業）拆解為小目標，並具備自我監督完成的能力。", weight: "7%" },
  { dimension: "第二維度：自我管理", code: "2-3-2", subDomain: "挫折忍受 (恆毅力)", description: "遭遇失敗（如比賽輸了）能調整心態並修正方法再嘗試，而非立即崩潰。", weight: "7%" },
  { dimension: "第三維度：社會覺察", code: "3-1-1", subDomain: "觀點取替 (換位)", description: "理解並接受「每個人對同一件事的感受與看法可能截然不同」。", weight: "5%" },
  { dimension: "第三維度：社會覺察", code: "3-1-2", subDomain: "情感同理表現", description: "觀察到他人受挫時，能給予適當的安慰或具體協助，而非袖手旁觀。", weight: "5%" },
  { dimension: "第三維度：社會覺察", code: "3-2-1", subDomain: "多元尊重與包容", description: "對於不同性格、背景、身心特質的同學能展現包容，避免偏見與歧視。", weight: "5%" },
  { dimension: "第三維度：社會覺察", code: "3-3-1", subDomain: "社會脈絡解讀", description: "能觀察並適應不同環境的社交規則（如：知道何時該嚴肅、何時可開玩笑）。", weight: "5%" },
  { dimension: "第四維度：人際技巧", code: "4-1-1", subDomain: "積極溝通技巧", description: "溝通時能專注傾聽，並習慣使用「我訊息」清楚表達自己的感受與需求。", weight: "6%" },
  { dimension: "第四維度：人際技巧", code: "4-2-1", subDomain: "協作領導與追隨", description: "在小組合作中能分享意見、尊重共識，並適時擔任領導 or 輔助者。", weight: "7%" },
  { dimension: "第四維度：人際技巧", code: "4-3-1", subDomain: "建設性衝突解決", description: "意見不合時，能主動提出協商、找尋折衷方案，而非爭吵或退縮。", weight: "7%" },
  { dimension: "第四維度：人際技巧", code: "4-3-2", subDomain: "同儕壓力抗性", description: "面對同儕的不合理誘惑或集體壓力，能禮貌但堅定地表達拒絕立場。", weight: "5%" },
  { dimension: "第五維度：負責任的決定", code: "5-1-1", subDomain: "因果邏輯預測", description: "決定行動前，能預想該行為對未來（例如：明天）及他人產生的後果。", weight: "7%" },
  { dimension: "第五維度：負責任的決定", code: "5-2-1", subDomain: "安全與倫理判斷", description: "行為選擇能優先考慮安全性、公平性與誠實原則，避免傷害性決策。", weight: "7%" },
  { dimension: "第五維度：負責任的決定", code: "5-3-1", subDomain: "問題解決決策", description: "面對突發問題，能冷靜列出可行的解決途徑，並選出副作用最小的方法。", weight: "6%" },
];

// --- Constants ---

const ADMIN_PASSWORD = 'admin123';
const ADMIN_EMAIL = 'doora0622@gmail.com';
const ADMIN_UID = 'bqLmbZ5rRNUmJxSpcrx6ch8D1Ep1';
const GUEST_UID = 'FbgAX4rIZHTzUU9m7klvmIAE2ru2';
const DEFAULT_COVER = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=600&fit=crop';

// --- Helper Functions ---

/**
 * Filter out undefined fields from objects before saving to Firestore
 */
const cleanData = (data: any): any => {
  if (typeof data !== 'object' || data === null) return data;
  const cleaned: any = Array.isArray(data) ? [] : {};
  Object.keys(data).forEach(key => {
    const value = data[key];
    if (value !== undefined) {
      cleaned[key] = cleanData(value);
    }
  });
  return cleaned;
};

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (error instanceof Error && error.message.includes('permission-denied')) {
    throw new Error(JSON.stringify(errInfo));
  }
  return errInfo;
};

const saveToStorage = (key: string, data: any) => {
  localStorage.setItem(`kids_book_paradise_${key}`, JSON.stringify(data));
};

const getFromStorage = (key: string, defaultValue: any) => {
  const stored = localStorage.getItem(`kids_book_paradise_${key}`);
  return stored ? JSON.parse(stored) : defaultValue;
};

const generateDescription = (title: string, keywords: string[]) => {
  const intros = ["這是一個關於", "讓我們一起探索", "一段充滿驚奇的"];
  const endings = ["的溫馨故事，非常適合小朋友閱讀。", "的冒險旅程，快來看看發生了什麼事！", "的奇幻世界，保證讓你愛不釋手。"];
  const randomIntro = intros[Math.floor(Math.random() * intros.length)];
  const randomEnding = endings[Math.floor(Math.random() * endings.length)];
  const kwString = keywords.length > 0 ? keywords.join('、') : "勇氣與友誼";
  return `${randomIntro} ${kwString} ${randomEnding}`;
};

const getYoutubeId = (url: string) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : url;
};

// --- Components ---

export default function App() {
  // --- State ---
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [books, setBooks] = useState<BookData[]>([]);
  const [contentQuizzes, setContentQuizzes] = useState<{ [bookId: string]: QuizQuestion[] }>({});
  const [selQuizzes, setSelQuizzes] = useState<{ [bookId: string]: QuizQuestion[] }>({});
  const [selIndicators, setSelIndicators] = useState<SELIndicator[]>([]);
  const [view, setView] = useState<'login' | 'home' | 'library' | 'study' | 'reading' | 'admin' | 'settings'>('login');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, title: string } | null>(null);
  const viewRef = useRef(view);
  const [selectedBook, setSelectedBook] = useState<BookData | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const adminLoginLock = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<{ bookTitle: string, report: any } | null>(null);
  const [parentalControl, setParentalControl] = useState(false);
  const [isLoginProcessing, setIsLoginProcessing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<{ bookId: string, type: 'content' | 'sel' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  
  // -- New Features States --
  const [showClock, setShowClock] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Clock Update Effect
  useEffect(() => {
    if (!showClock) return;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [showClock]);

  const handleSaveQuizzes = async (bookId: string, questions: QuizQuestion[], type: 'content' | 'sel') => {
    if (!auth.currentUser) {
      alert("⚠️ 目前無法同步至雲端！\n請務必開啟 Firebase 匿名登入 (Anonymous Auth)。");
      return;
    }
    setIsProcessing(true);
    const collectionPath = type === 'content' ? `kidsbook-GitHub-to-Firebase/${bookId}/content_quizzes` : `kidsbook-GitHub-to-Firebase/${bookId}/sel_quizzes`;
    try {
      const quizzesRef = collection(db, collectionPath);
      // Delete old quizzes first
      const oldDocs = await getDocs(quizzesRef);
      const batch = writeBatch(db);
      oldDocs.forEach(d => batch.delete(d.ref));
      
      // Add new ones
      questions.forEach((q, i) => {
        const qRef = doc(quizzesRef, i.toString());
        batch.set(qRef, cleanData({ ...q, type }));
      });
      
      await batch.commit();
      alert(`✅ ${type === 'content' ? '故事內容' : 'SEL'} 測驗題目已儲存！`);
      setEditingQuiz(null); 
    } catch (error: any) {
      const errDetail = handleFirestoreError(error, OperationType.WRITE, collectionPath);
      alert(`❌ 儲存失敗：${errDetail.error}\nUID: ${errDetail.authInfo.userId}\n路徑: ${errDetail.path}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteBook = (id: string, title: string) => {
    setDeleteConfirm({ id, title });
  };

  const confirmDeleteAction = async () => {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'kidsbook-GitHub-to-Firebase', id));
      alert("✅ 圖書已刪除");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, `kidsbook-GitHub-to-Firebase/${id}`);
      alert("❌ 刪除失敗：權限不足");
    } finally {
      setIsProcessing(false);
    }
  };

  // Sync ref with state
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // --- Initialization ---
  useEffect(() => {
    // Auth Listener
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      try {
        setFirebaseUser(user);
        
        if (user) {
          // If it's a real user (not anonymous), handle Firestore sync
          if (!user.isAnonymous) {
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (userDoc.exists()) {
              setCurrentUser(userDoc.data() as UserData);
            } else {
              const initialUser: UserData = {
                nickname: user.displayName || '讀書小博士',
                favoriteBookIds: [],
                passedBookIds: [],
                readingProgress: {}
              };
              try {
                await setDoc(userDocRef, cleanData(initialUser));
              } catch (error) {
                handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
              }
              setCurrentUser(initialUser);
            }
          }

          // Check Admin Status (UID or Email check)
          const isUserAdmin = 
            user.uid === 'bqLmbZ5rRNUmJxSpcrx6ch8D1Ep1' || 
            user.email?.toLowerCase() === 'doora0622@gmail.com';
            
          if (isUserAdmin) {
            setIsAdmin(true);
            if (viewRef.current === 'login') setView('home');
            
            // Bootstrap admin document for persistent rules access
            if (user.uid) {
              const adminDocRef = doc(db, 'admins', user.uid);
              getDoc(adminDocRef).then(doc => {
                if (!doc.exists()) {
                  setDoc(adminDocRef, {}).catch((error) => {
                    handleFirestoreError(error, OperationType.WRITE, `admins/${user.uid}`);
                  });
                }
              }).catch(() => {});
            }
          } else if (viewRef.current === 'login' && !adminLoginLock.current) {
            setView('home');
            if (!user.isAnonymous) setIsAdmin(false);
          }
        } else {
          setCurrentUser(null);
          // Only reset to login view if we aren't in the middle of a manual override (like admin password)
          if (!adminLoginLock.current) {
            setIsAdmin(false);
            setView('login');
          }
        }
      } catch (error) {
        console.error("Auth listener error:", error);
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Data Listeners (Public)
  useEffect(() => {
    // Books Listener (Public)
    const booksQuery = query(collection(db, 'kidsbook-GitHub-to-Firebase'), orderBy('createdAt', 'desc'));
    const unsubscribeBooks = onSnapshot(booksQuery, (snapshot) => {
      const booksList: BookData[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BookData));
      setBooks(booksList);
    }, (error) => {
      console.warn("Public books listener error (may be fine if not deployed):", error);
    });

    // SEL Indicators Listener (Public)
    const selQuery = query(collection(db, 'sel_indicators'));
    const unsubscribeSel = onSnapshot(selQuery, (snapshot) => {
      const selList: SELIndicator[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SELIndicator));
      // Sort in client to avoid requiring composite indexes
      selList.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      console.log("SEL Indicators updated:", selList.length, "items");
      setSelIndicators(selList);
    }, (error) => {
      console.error("Critical: Public SEL indicators listener error:", error);
    });

    return () => {
      unsubscribeBooks();
      unsubscribeSel();
    };
  }, []);

  // Sync Current User Data when document changes in Firestore
  useEffect(() => {
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    const unsubscribeUser = onSnapshot(doc(db, 'users', firebaseUser.uid), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentUser(snapshot.data() as UserData);
      }
    });
    return () => unsubscribeUser();
  }, [firebaseUser]);

  // Quizzes listener for selected book
  useEffect(() => {
    if (!selectedBook) return;
    
    // Content Quizzes
    const unsubscribeContent = onSnapshot(collection(db, `kidsbook-GitHub-to-Firebase/${selectedBook.id}/content_quizzes`), (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as QuizQuestion);
      setContentQuizzes(prev => ({ ...prev, [selectedBook.id]: list }));
    });

    // SEL Quizzes
    const unsubscribeSEL = onSnapshot(collection(db, `kidsbook-GitHub-to-Firebase/${selectedBook.id}/sel_quizzes`), (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as QuizQuestion);
      setSelQuizzes(prev => ({ ...prev, [selectedBook.id]: list }));
    });

    return () => {
      unsubscribeContent();
      unsubscribeSEL();
    };
  }, [selectedBook]);

  // --- Handlers ---

  const handleLogin = async (type: 'guest' | 'admin' | 'google', name?: string, pass?: string) => {
    if (isLoginProcessing) return;
    setIsLoginProcessing(true);
    setAuthError(null);
    try {
      if (type === 'google') {
        await loginWithGoogle();
        return;
      }

      if (type === 'guest') {
        if (!name?.trim()) {
          setIsLoginProcessing(false);
          return;
        }
        try {
          await loginAnonymously();
        } catch (authErr: any) {
          if (authErr.code === 'auth/admin-restricted-operation' || authErr.code === 'auth/operation-not-allowed') {
            console.warn("Anonymous auth disabled, continuing in local guest mode");
            setAuthError("您的 Firebase 專案未啟用「匿名登入」，目前的遊客登入將無法雲端同步。");
            setCurrentUser({
              nickname: name,
              favoriteBookIds: [],
              passedBookIds: [],
              readingProgress: {}
            });
            setView('home');
            setIsLoginProcessing(false);
            return;
          }
          throw authErr;
        }
        
        setCurrentUser({
          nickname: name,
          favoriteBookIds: [],
          passedBookIds: [],
          readingProgress: {}
        });
        setView('home');
      } else if (type === 'admin') {
        if (pass === ADMIN_PASSWORD) {
          adminLoginLock.current = true;
          setIsAdmin(true);
          
          try {
            await loginAnonymously();
          } catch (authErr: any) {
            console.warn("Admin Session Login: Anonymous auth disabled, using local session admin");
            setAuthError("Firebase 專案未啟用「匿名登入」。身為管理員，您必須啟用它才能上傳書籍。");
          }

          setCurrentUser({
            nickname: '系統管理員',
            favoriteBookIds: [],
            passedBookIds: [],
            readingProgress: {}
          });
          setView('admin');
          // Release lock after a longer delay to ensure state propagates
          setTimeout(() => { adminLoginLock.current = false; }, 3000);
        } else {
          alert('⚠️ 密碼錯誤，請重新輸入！');
        }
      }
    } catch (error: any) {
      console.error("Login failed:", error);
      let msg = '登入失敗，請確認網路連線或稍後再試。';
      if (error.code === 'auth/operation-not-allowed' || error.code === 'auth/admin-restricted-operation') {
        msg = '管理員您好：請到 Firebase Console 的 Authentication > Sign-in method 頁面「啟用匿名登入 (Anonymous Auth)」功能。';
      }
      alert(msg);
      adminLoginLock.current = false;
      setIsAdmin(false);
    } finally {
      setIsLoginProcessing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await firebaseLogout();
      setIsAdmin(false);
      setCurrentUser(null);
      setView('login');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const toggleFavorite = async (bookId: string) => {
    if (!firebaseUser || !currentUser) return;
    const newFavorites = currentUser.favoriteBookIds.includes(bookId)
      ? currentUser.favoriteBookIds.filter(id => id !== bookId)
      : [...currentUser.favoriteBookIds, bookId];
    
    // Update local state for responsiveness (always)
    setCurrentUser(prev => prev ? { ...prev, favoriteBookIds: newFavorites } : null);

    // Only save to cloud if NOT anonymous (Guest mode doesn't save)
    if (!firebaseUser.isAnonymous) {
      try {
        await setDoc(doc(db, 'users', firebaseUser.uid), cleanData({ favoriteBookIds: newFavorites }), { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
  };

  const markAsPassed = async (bookId: string) => {
    if (!firebaseUser || !currentUser) return;
    if (currentUser.passedBookIds.includes(bookId)) return;
    
    const newPassed = [...currentUser.passedBookIds, bookId];
    setCurrentUser(prev => prev ? { ...prev, passedBookIds: newPassed } : null);

    if (!firebaseUser.isAnonymous) {
      try {
        await setDoc(doc(db, 'users', firebaseUser.uid), cleanData({ 
          passedBookIds: newPassed 
        }), { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
  };

  const updateProgress = async (bookId: string, progress: any) => {
    if (!firebaseUser || !currentUser) return;
    const newProgress = { ...currentUser.readingProgress, [bookId]: progress };
    
    setCurrentUser(prev => prev ? { ...prev, readingProgress: newProgress } : null);

    if (!firebaseUser.isAnonymous) {
      try {
        await setDoc(doc(db, 'users', firebaseUser.uid), cleanData({
          readingProgress: newProgress
        }), { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }
  };

  const handleAdminAccess = () => {
    if (isAdmin) {
      setView('admin');
    } else {
      setShowAdminModal(true);
    }
  };

  const handleAdminVerify = (email: string, pass: string) => {
    // Basic password validation
    if (pass === ADMIN_PASSWORD) {
      // If email matches, we consider them admin for this session even if not signed in with that UID
      if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        setIsAdmin(true);
        setView('admin');
        setShowAdminModal(false);
        return true;
      }
    }
    return false;
  };

  // --- Computed Data ---

  const filteredBooks = useMemo(() => {
    let list = books;
    if (parentalControl) {
      list = list.filter(b => currentUser?.passedBookIds.includes(b.id));
    }
    if (selectedKeyword) {
      list = list.filter(b => b.keywords.includes(selectedKeyword));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b => 
        b.title.toLowerCase().includes(q) || 
        b.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [books, searchQuery, selectedKeyword, parentalControl, currentUser]);

  const allKeywords = useMemo(() => {
    const kws = new Set<string>();
    books.forEach(b => b.keywords.forEach(k => kws.add(k)));
    return Array.from(kws);
  }, [books]);

  const dailyRecommendation = useMemo(() => {
    if (books.length === 0) return null;
    // Use date as seed for daily recommendation
    const day = new Date().getDate();
    return books[day % books.length];
  }, [books]);

  // --- Views ---

  if (isLoading) {
    return (
      <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-orange-500 mb-4" size={48} />
        <p className="font-bold text-orange-600">小博士正在準備圖書中...</p>
      </div>
    );
  }

  if (view === 'login') {
    return <LoginView onLogin={handleLogin} isProcessing={isLoginProcessing} />;
  }

  return (
    <div className="min-h-screen bg-orange-50 font-sans text-gray-800 pb-20">
      {/* Fullscreen Hidden Toggle */}
      <div 
        onClick={() => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
              console.error(`Error attempting to enable full-screen mode: ${err.message}`);
            });
          } else {
            document.exitFullscreen();
          }
        }}
        className="fixed bottom-0 right-0 w-8 h-8 z-[9999] opacity-0 hover:opacity-10 cursor-pointer flex items-center justify-center text-gray-400"
        title="Toggle Fullscreen"
      >
        <Maximize size={12} />
      </div>

      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-30 px-2 py-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setView('home')}>
          <div className="bg-orange-400 p-1 rounded-lg">
            <Book className="text-white" size={18} />
          </div>
          <h1 className="text-sm font-bold text-orange-600 tracking-tight">文心童書樂園</h1>
        </div>
        
        <div className="flex items-center gap-1">
          {showClock && (
            <div key="digital-clock" className="px-2 py-0.5 bg-orange-50 rounded-lg border border-orange-100 flex flex-col items-center mr-1">
              <span className="text-[10px] font-black text-orange-600 leading-none">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-[6px] text-orange-400 font-bold uppercase tracking-widest mt-0.5">Digital Time</span>
            </div>
          )}
          <button 
            onClick={() => setView('study')}
            className={`p-1 rounded-full transition-colors ${view === 'study' ? 'bg-orange-100 text-orange-600' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <Star size={16} />
          </button>
          <button 
            onClick={() => setView('settings')}
            className={`p-1 rounded-full transition-colors ${view === 'settings' ? 'bg-orange-100 text-orange-600' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <Settings size={16} />
          </button>
          <div className="h-4 w-px bg-gray-200 mx-0.5"></div>
          <div className="flex items-center gap-1 bg-gray-50 px-1.5 py-0.5 rounded-full border border-gray-100">
            {firebaseUser ? (
              <img src={firebaseUser.photoURL || undefined} alt="" className="w-3 h-3 rounded-full" />
            ) : (
              <User size={12} className="text-orange-400" />
            )}
            <span className="text-[9px] font-medium">{currentUser?.nickname}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-3 pb-16 md:pb-4">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {/* Daily Recommendation */}
              {dailyRecommendation && (
                <section>
                  <h2 className="text-base font-bold mb-3 flex items-center gap-2">
                    <Star className="text-yellow-400 fill-yellow-400" size={18} />
                    今日推薦
                  </h2>
                  <div 
                    onClick={() => { setSelectedBook(dailyRecommendation); setView('reading'); }}
                    className="bg-gradient-to-br from-orange-400 to-pink-400 rounded-2xl p-4 text-white flex flex-col md:flex-row gap-4 cursor-pointer hover:shadow-lg transition-all overflow-hidden relative group"
                  >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                      <Book size={80} />
                    </div>
                    <img 
                      src={dailyRecommendation.coverImageUrl || DEFAULT_COVER} 
                      alt={dailyRecommendation.title}
                      className="w-20 h-28 object-cover rounded-xl shadow-lg z-10 mx-auto md:mx-0"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1 z-10 text-center md:text-left">
                      <h3 className="text-lg font-bold mb-1">{dailyRecommendation.title}</h3>
                      <p className="text-orange-50 opacity-90 mb-2 line-clamp-2 text-xs">{dailyRecommendation.description}</p>
                      <div className="flex flex-wrap gap-1.5 justify-center md:justify-start">
                        {dailyRecommendation.keywords.map(kw => (
                          <span key={kw} className="bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-medium">#{kw}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Quick Access */}
              <section className="grid grid-cols-2 gap-2 relative">
                {/* Hidden Fullscreen Button */}
                <button 
                  onClick={() => {
                    if (!document.fullscreenElement) {
                      document.documentElement.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable fullscreen: ${err.message}`);
                      });
                    } else {
                      document.exitFullscreen();
                    }
                  }}
                  className="absolute -top-12 -right-4 w-8 h-8 opacity-0 hover:opacity-10 cursor-default flex items-center justify-center transition-opacity"
                  title="全螢幕模式"
                >
                  <Maximize2 size={12} />
                </button>
                <button 
                  onClick={() => setView('library')}
                  className="bg-blue-50 p-2 rounded-2xl flex flex-col items-center gap-0.5 hover:bg-blue-100 transition-colors border border-blue-100/50"
                >
                  <div className="bg-blue-400 p-1.5 rounded-lg text-white">
                    <Search size={16} />
                  </div>
                  <span className="font-bold text-blue-700 text-[10px]">探索書庫</span>
                </button>
                <button 
                  onClick={() => setView('study')}
                  className="bg-purple-50 p-2 rounded-2xl flex flex-col items-center gap-0.5 hover:bg-purple-100 transition-colors border border-purple-100/50"
                >
                  <div className="bg-purple-400 p-1.5 rounded-lg text-white">
                    <Award size={16} />
                  </div>
                  <span className="font-bold text-purple-700 text-[10px]">我的成就</span>
                </button>
              </section>

              {/* Recent Books */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold">最新上架</h2>
                  <button onClick={() => setView('library')} className="text-orange-500 text-xs font-bold hover:underline">查看全部書庫</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {books.slice(0, showAllRecent ? undefined : 8).map(book => (
                    <BookCard 
                      key={book.id} 
                      book={book} 
                      isFavorite={currentUser?.favoriteBookIds.includes(book.id)}
                      isPassed={currentUser?.passedBookIds.includes(book.id)}
                      onToggleFavorite={() => toggleFavorite(book.id)}
                      onClick={() => { setSelectedBook(book); setView('reading'); }}
                    />
                  ))}
                </div>
                {books.length > 8 && (
                  <button 
                    onClick={() => setShowAllRecent(!showAllRecent)}
                    className="w-full mt-4 py-2 border-2 border-dashed border-orange-100 rounded-2xl text-orange-500 text-xs font-black hover:bg-orange-50 transition-all flex items-center justify-center gap-2"
                  >
                    {showAllRecent ? '收起部分書籍' : `顯示更多書籍 (還有 ${books.length - 8} 本)`}
                    {showAllRecent ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </section>
            </motion.div>
          )}

          {view === 'library' && (
            <motion.div 
              key="library"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col gap-4">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="搜尋書名或簡介..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-xl border-2 border-orange-100 focus:border-orange-400 outline-none transition-colors bg-white text-[13px]"
                  />
                </div>
                
                <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1.5 scrollbar-hide">
                  <button 
                    onClick={() => setSelectedKeyword(null)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-colors ${!selectedKeyword ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border border-gray-100'}`}
                  >
                    全部
                  </button>
                  {allKeywords.map(kw => (
                    <button 
                      key={kw}
                      onClick={() => setSelectedKeyword(kw === selectedKeyword ? null : kw)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap transition-colors ${selectedKeyword === kw ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border border-gray-100'}`}
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {filteredBooks.map(book => (
                  <BookCard 
                    key={book.id} 
                    book={book} 
                    isFavorite={currentUser?.favoriteBookIds.includes(book.id)}
                    isPassed={currentUser?.passedBookIds.includes(book.id)}
                    onToggleFavorite={() => toggleFavorite(book.id)}
                    onClick={() => { setSelectedBook(book); setView('reading'); }}
                  />
                ))}
                {filteredBooks.length === 0 && (
                  <div className="col-span-full py-20 text-center text-gray-400">
                    <Book size={48} className="mx-auto mb-4 opacity-20" />
                    <p>找不到相關書籍，換個關鍵字試試看吧！</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'study' && (
            <motion.div 
              key="study"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <section>
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Heart className="text-red-500 fill-red-500" size={20} />
                  我的最愛
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {books.filter(b => currentUser?.favoriteBookIds.includes(b.id)).map(book => (
                    <BookCard 
                      key={book.id} 
                      book={book} 
                      isFavorite={true}
                      isPassed={currentUser?.passedBookIds.includes(book.id)}
                      onToggleFavorite={() => toggleFavorite(book.id)}
                      onClick={() => { setSelectedBook(book); setView('reading'); }}
                    />
                  ))}
                  {currentUser?.favoriteBookIds.length === 0 && (
                    <div className="col-span-full py-10 text-center text-gray-400 bg-white rounded-3xl border-2 border-dashed border-gray-100">
                      <p>還沒有收藏任何書籍喔！</p>
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Award className="text-yellow-500" size={20} />
                  已通過測驗
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {books.filter(b => currentUser?.passedBookIds.includes(b.id)).map(book => (
                    <div key={book.id} className="space-y-2">
                      <BookCard 
                        book={book} 
                        isFavorite={currentUser?.favoriteBookIds.includes(book.id)}
                        isPassed={true}
                        onToggleFavorite={() => toggleFavorite(book.id)}
                        onClick={() => { setSelectedBook(book); setView('reading'); }}
                      />
                      {currentUser?.selFeedback[book.id] && (
                        <button 
                          onClick={() => setSelectedReport({ bookTitle: book.title, report: currentUser.selFeedback[book.id] })}
                          className="w-full py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-black shadow-sm border border-blue-100 flex items-center justify-center gap-1 hover:bg-blue-100 transition-all"
                        >
                          <Sparkles size={14} />
                          查看 SEL 報告
                        </button>
                      )}
                    </div>
                  ))}
                  {currentUser?.passedBookIds.length === 0 && (
                    <div className="col-span-full py-10 text-center text-gray-400 bg-white rounded-3xl border-2 border-dashed border-gray-100">
                      <p>加油！讀完書並通過測驗就能獲得勳章喔！</p>
                    </div>
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {view === 'reading' && selectedBook && (
            <motion.div 
              key="reading-view-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full"
            >
              <ReadingView 
                book={selectedBook} 
                onBack={() => setView('library')} 
                onPass={() => markAsPassed(selectedBook.id)}
                isPassed={currentUser?.passedBookIds.includes(selectedBook.id)}
                contentQuizzes={contentQuizzes[selectedBook.id] || []}
                selQuizzes={selQuizzes[selectedBook.id] || []}
                selIndicators={selIndicators}
                savedProgress={currentUser?.readingProgress[selectedBook.id]}
                onSaveProgress={(p) => updateProgress(selectedBook.id, p)}
                isAdmin={isAdmin}
                onEditQuiz={(type) => setEditingQuiz({ bookId: selectedBook.id, type })}
                onSaveSELResult={async (res) => {
                  if (!currentUser || firebaseUser?.isAnonymous) return;
                  const updatedFeedback = {
                    ...currentUser.selFeedback,
                    [selectedBook.id]: {
                      ...res,
                      date: Date.now()
                    }
                  };
                  setCurrentUser({ ...currentUser, selFeedback: updatedFeedback });
                  try {
                    await setDoc(doc(db, 'users', firebaseUser!.uid), cleanData({ selFeedback: updatedFeedback }), { merge: true });
                  } catch (error) {
                    handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser!.uid}`);
                  }
                }}
              />
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
            <h2 className="text-xl font-bold">設定</h2>
              
              <div className="bg-white rounded-3xl p-6 shadow-sm space-y-6">
                <div key="clock-toggle" className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-orange-100 p-2 rounded-xl text-orange-600">
                      <Star size={20} />
                    </div>
                    <div>
                      <p className="font-bold">數位時鐘顯示</p>
                      <p className="text-xs text-gray-500">在導覽列顯示當前時間</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowClock(!showClock)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${showClock ? 'bg-orange-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${showClock ? 'left-7' : 'left-1'}`}></div>
                  </button>
                </div>

                <div className="h-px bg-gray-100"></div>

                <div key="parental-toggle" className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-100 p-2 rounded-xl text-blue-600">
                      <Lock size={20} />
                    </div>
                    <div>
                      <p className="font-bold">家長控制模式</p>
                      <p className="text-xs text-gray-500">僅顯示已通過測驗的書籍</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setParentalControl(!parentalControl)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${parentalControl ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${parentalControl ? 'left-7' : 'left-1'}`}></div>
                  </button>
                </div>

                <div className="h-px bg-gray-100"></div>

                <button 
                  onClick={handleAdminAccess}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-orange-50 text-orange-600 font-bold hover:bg-orange-100 transition-colors"
                >
                  <Settings size={20} />
                  管理者模式
                </button>

                <div className="h-px bg-gray-100"></div>

                <div className="bg-orange-50/50 rounded-2xl p-4 space-y-3">
                  <h4 className="font-bold text-gray-700 flex items-center gap-2">
                    <User size={18} className="text-orange-500" /> 帳號資訊
                  </h4>
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">
                      身分：{isAdmin ? '✨ 管理者' : firebaseUser?.isAnonymous ? '👤 匿名使用者' : '👤 一般使用者'}
                    </p>
                    {firebaseUser?.email && <p className="text-sm text-gray-500">信箱：{firebaseUser.email}</p>}
                    <p className="text-sm text-gray-500 flex items-center gap-2">
                      UID：
                      <code className="bg-white px-2 py-1 rounded text-xs select-all border border-orange-100">{firebaseUser?.uid}</code>
                    </p>
                    {!isAdmin && (
                      <p className="text-[10px] text-gray-400">若要啟用管理權限，請聯絡系統管理員或將 UID 加入權限清單。</p>
                    )}
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-full py-3 rounded-xl bg-white text-red-500 font-bold hover:bg-red-50 transition-colors flex items-center justify-center gap-2 border border-red-100"
                  >
                    <LogOut size={18} /> 登出帳號
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'admin' && (
            <motion.div 
              key="admin-panel"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full"
            >
              <AdminView 
                books={books} 
                selIndicators={selIndicators}
                onBack={() => setView('settings')}
                authError={authError}
                isAdmin={isAdmin}
                firebaseUser={firebaseUser}
                onEditQuiz={(bookId, type) => setEditingQuiz({ bookId, type })}
                onDeleteBook={handleDeleteBook}
                showAttendance={showAttendance}
                onToggleAttendance={() => setShowAttendance(!showAttendance)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {showAdminModal && (
          <AdminModal 
            onClose={() => setShowAdminModal(false)}
            onVerify={handleAdminVerify}
          />
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-start justify-center p-6 pt-4 md:pt-10">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5 border-t-8 border-red-500"
            >
              <div className="text-center space-y-1.5">
                <div className="bg-red-50 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto text-red-500">
                  <Trash2 size={28} />
                </div>
                <h3 className="text-xl font-bold text-gray-800">確定要刪除嗎？</h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  您即將刪除「<span className="font-bold text-red-500">{deleteConfirm.title}</span>」。注意：此操作無法復原，測驗紀錄也將一併移除。
                </p>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 transition-all text-sm"
                >
                  回上一頁
                </button>
                <button 
                  onClick={confirmDeleteAction}
                  className="flex-[2] py-3 rounded-xl bg-red-500 text-white text-base font-bold shadow-lg shadow-red-100 hover:bg-red-600 active:scale-95 transition-all"
                >
                  確定刪除
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {editingQuiz && (
          <QuizEditor 
            bookId={editingQuiz.bookId}
            type={editingQuiz.type}
            bookTitle={books.find(b => b.id === editingQuiz.bookId)?.title || ''}
            selIndicators={selIndicators}
            onSave={(questions) => handleSaveQuizzes(editingQuiz.bookId, questions, editingQuiz.type)}
            onCancel={() => setEditingQuiz(null)}
          />
        )}
      </main>

      {/* Footer */}
      <footer 
        className="fixed bottom-0 left-0 right-0 p-4 text-center text-gray-300 text-[10px] select-none"
      >
        © 2024 文心童書樂園 - 讓閱讀成為最快樂的冒險
      </footer>

      {/* Navigation Bar (Mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-3 flex justify-around items-center z-40 md:hidden">
        <button onClick={() => setView('home')} className={`flex flex-col items-center gap-1 ${view === 'home' ? 'text-orange-500' : 'text-gray-400'}`}>
          <Book size={24} />
          <span className="text-[10px] font-bold">首頁</span>
        </button>
        <button onClick={() => setView('library')} className={`flex flex-col items-center gap-1 ${view === 'library' ? 'text-orange-500' : 'text-gray-400'}`}>
          <Search size={24} />
          <span className="text-[10px] font-bold">書庫</span>
        </button>
        <button onClick={() => setView('study')} className={`flex flex-col items-center gap-1 ${view === 'study' ? 'text-orange-500' : 'text-gray-400'}`}>
          <Award size={24} />
          <span className="text-[10px] font-bold">成就</span>
        </button>
        <button onClick={() => setView('settings')} className={`flex flex-col items-center gap-1 ${view === 'settings' ? 'text-orange-500' : 'text-gray-400'}`}>
          <Settings size={24} />
          <span className="text-[10px] font-bold">設定</span>
        </button>
      </nav>

      {selectedReport && (
        <SELReportModal 
          bookTitle={selectedReport.bookTitle}
          report={selectedReport.report}
          onClose={() => setSelectedReport(null)}
        />
      )}
    </div>
  );
}

// --- Attendance Calculator Feature ---

function AttendanceCalculator() {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(30);
  const [remarks, setRemarks] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-xl text-purple-600">
            <CheckCircle size={24} />
          </div>
          <div>
            <h4 className="font-black text-gray-800">點名計算器</h4>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Attendance Counter</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-white border border-purple-200 px-4 py-2 rounded-2xl shadow-sm">
          <span className="text-xs font-black text-purple-600">出席率：</span>
          <span className="text-lg font-black text-gray-800">{total > 0 ? Math.round((count / total) * 100) : 0}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">實到人數</label>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCount(Math.max(0, count - 1))}
              className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 font-black"
            >
              -
            </button>
            <input 
              type="number" 
              value={count} 
              onChange={e => setCount(parseInt(e.target.value) || 0)}
              className="flex-1 h-10 rounded-xl bg-white border border-gray-200 text-center font-black text-purple-600 focus:border-purple-400 outline-none"
            />
            <button 
              onClick={() => setCount(count + 1)}
              className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 font-black"
            >
              +
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">應到總數</label>
          <input 
            type="number" 
            value={total} 
            onChange={e => setTotal(parseInt(e.target.value) || 0)}
            className="w-full h-10 rounded-xl bg-white border border-gray-200 text-center font-black text-gray-700 focus:border-purple-400 outline-none"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">缺席備註</label>
        <textarea 
          placeholder="輸入缺席名單或其他備註..."
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          className="w-full p-4 rounded-2xl bg-white border border-gray-200 text-sm focus:border-purple-400 outline-none resize-none h-20"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button 
          onClick={() => { setCount(0); setRemarks(''); }}
          className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
        >
          重新歸零
        </button>
        <button 
          className="bg-purple-600 text-white px-6 py-2 rounded-xl text-xs font-black shadow-lg shadow-purple-100 hover:bg-purple-700 transition-all flex items-center gap-2"
        >
          <Save size={14} /> 儲存目前數據
        </button>
      </div>
    </div>
  );
}

// --- Original Sub-Components ---

function LoginView({ onLogin, isProcessing }: { onLogin: (type: 'guest' | 'admin' | 'google', name?: string, pass?: string) => void, isProcessing: boolean }) {
  const [mode, setMode] = useState<'selection' | 'guest' | 'admin'>('selection');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const handleAdminSubmit = () => {
    if (password === ADMIN_PASSWORD) {
      setLocalError('');
      onLogin('admin', ADMIN_EMAIL, password);
    } else {
      setLocalError('密碼錯誤，請重新輸入！');
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-orange-400 flex items-center justify-center p-4 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <motion.div 
        layout
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-xl p-3 shadow-xl space-y-2 border-2 border-orange-100 max-w-[280px] w-full mx-auto"
      >
        <div className="space-y-0 text-center">
          <div className="bg-orange-100 w-8 h-8 rounded-lg flex items-center justify-center mx-auto shadow-inner mb-0.5">
            <Book className="text-orange-500" size={16} />
          </div>
          <h1 className="text-sm font-black text-orange-600 tracking-tight">文心童書樂園</h1>
          <p className="text-gray-400 font-medium tracking-wide text-[7px]">✨ 入口奇幻選擇 ✨</p>
        </div>

        {mode === 'selection' && (
          <div className="grid grid-cols-1 gap-1.5">
            <button 
              onClick={() => setMode('guest')}
              disabled={isProcessing}
              className="group relative overflow-hidden p-2.5 rounded-[16px] bg-white border border-orange-50 hover:border-orange-400 transition-all text-left shadow-md hover:shadow-orange-50 disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform flex-shrink-0">
                  <User size={16} />
                </div>
                <div>
                  <h2 className="text-[13px] font-black text-gray-800 leading-tight">一般登入</h2>
                  <p className="text-[8px] text-gray-400 font-medium font-sans">直接開始旅程</p>
                </div>
              </div>
            </button>

            <button 
              onClick={() => onLogin('google')}
              disabled={isProcessing}
              className="group relative overflow-hidden p-2.5 rounded-[16px] bg-white border border-blue-50 hover:border-blue-400 transition-all text-left shadow-md hover:shadow-blue-50 disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform flex-shrink-0">
                  <LogIn size={16} />
                </div>
                <div>
                  <h2 className="text-[13px] font-black text-gray-800 leading-tight">Google 登入</h2>
                  <p className="text-[8px] text-gray-400 font-medium font-sans">家長與管理員</p>
                </div>
              </div>
            </button>

            <button 
              onClick={() => setMode('admin')}
              disabled={isProcessing}
              className="group relative overflow-hidden p-2.5 rounded-[16px] bg-white border border-purple-50 hover:border-purple-400 transition-all text-left shadow-md hover:shadow-purple-50 disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-500 group-hover:scale-110 transition-transform flex-shrink-0">
                  <Lock size={16} />
                </div>
                <div>
                  <h2 className="text-[13px] font-black text-gray-800 leading-tight">管理者登入</h2>
                  <p className="text-[8px] text-gray-400 font-medium font-sans">系統維護專用</p>
                </div>
              </div>
            </button>
          </div>
        )}

        {mode === 'guest' && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="space-y-3">
            <div className="space-y-0.5 text-center">
              <h2 className="text-sm font-black text-orange-600">哈囉！小朋友</h2>
              <p className="text-gray-500 font-medium text-[9px]">你叫什麼名字呢？</p>
            </div>
            <input 
              type="text" 
              autoFocus
              placeholder="輸入你的暱稱..." 
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={isProcessing}
              className="w-full px-3 py-1.5 rounded-lg bg-gray-50 border border-transparent focus:border-orange-400 outline-none text-center text-xs font-bold transition-all text-orange-600 disabled:opacity-50"
              onKeyDown={(e) => e.key === 'Enter' && nickname.trim() && !isProcessing && onLogin('guest', nickname)}
            />
            <div className="flex gap-1.5">
              <button 
                onClick={() => setMode('selection')}
                disabled={isProcessing}
                className="flex-1 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-[9px] font-bold hover:bg-gray-200 transition-all disabled:opacity-50"
              >
                返回
              </button>
              <button 
                onClick={() => onLogin('guest', nickname)}
                disabled={!nickname.trim() || isProcessing}
                className="flex-[2] py-1.5 rounded-lg bg-orange-500 text-white text-xs font-bold shadow-md shadow-orange-50 hover:bg-orange-600 disabled:opacity-50 transition-all flex items-center justify-center gap-1"
              >
                {isProcessing && <Loader2 className="animate-spin" size={14} />}
                開始旅程
              </button>
            </div>
          </motion.div>
        )}

        {mode === 'admin' && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="space-y-3">
            <div className="space-y-0.5 text-center">
              <h2 className="text-sm font-black text-purple-600">系統管理驗證</h2>
              <p className="text-gray-500 font-medium text-[9px]">請輸入管理員通行密碼</p>
            </div>
            
            <div className="space-y-2">
              <div className="relative">
                <input 
                  type="password" 
                  placeholder="請輸入通行密碼..." 
                  value={password}
                  disabled={isProcessing}
                  autoFocus
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLocalError('');
                  }}
                  className={`w-full px-3 py-2 rounded-lg bg-gray-50 border outline-none text-center text-xs font-bold transition-all disabled:opacity-50 ${localError ? 'border-red-400 bg-red-50 text-red-600' : 'border-transparent focus:border-purple-400 text-purple-600'}`}
                  onKeyDown={(e) => e.key === 'Enter' && password.trim() && !isProcessing && handleAdminSubmit()}
                />
              </div>
              {localError && (
                <motion.p 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-500 text-[9px] font-bold mt-0.5 text-center"
                >
                  {localError}
                </motion.p>
              )}
            </div>
            <div className="flex gap-1.5">
              <button 
                onClick={() => setMode('selection')}
                disabled={isProcessing}
                className="flex-1 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-[9px] font-bold hover:bg-gray-200 transition-all disabled:opacity-50"
              >
                返回
              </button>
              <button 
                onClick={handleAdminSubmit}
                disabled={!password.trim() || isProcessing}
                className="flex-[2] py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold shadow-md shadow-purple-50 hover:bg-purple-700 disabled:opacity-50 transition-all font-sans flex items-center justify-center gap-1"
              >
                {isProcessing && <Loader2 className="animate-spin" size={14} />}
                登入管理
              </button>
            </div>
          </motion.div>
        )}
        
        <p className="text-center text-[10px] text-gray-300 uppercase tracking-widest font-bold">Kids Book Paradise • Version 2.0</p>
      </motion.div>
    </div>
  );
}

interface BookCardProps {
  book: BookData;
  isFavorite?: boolean;
  isPassed?: boolean;
  onToggleFavorite: () => void;
  onClick: () => void;
  key?: React.Key;
}

function BookCard({ book, isFavorite, isPassed, onToggleFavorite, onClick }: BookCardProps) {
  return (
    <motion.div 
      whileHover={{ y: -3 }}
      className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex flex-col group relative"
    >
      <div className="relative aspect-[3/4] cursor-pointer overflow-hidden" onClick={onClick}>
        <img 
          src={book.coverImageUrl || DEFAULT_COVER} 
          alt={book.title} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
        
        {/* Type Badge */}
        <div className="absolute top-1.5 left-1.5 bg-white/90 backdrop-blur-sm p-1 rounded-lg shadow-sm">
          {book.type === 'pdf' && <FileText size={14} className="text-blue-500" />}
          {book.type === 'youtube' && <Youtube size={14} className="text-red-500" />}
          {book.type === 'video' && <Video size={14} className="text-purple-500" />}
          {book.type === 'text' && <FileText size={14} className="text-green-500" />}
        </div>

        {/* Passed Badge */}
        {isPassed && (
          <div className="absolute top-1.5 right-1.5 bg-yellow-400 p-1 rounded-full shadow-md z-20">
            <Award size={14} className="text-white" />
          </div>
        )}
      </div>

      <div className="p-1 space-y-0">
        <div className="flex items-start justify-between gap-0.5">
          <h3 className="font-bold text-[11px] line-clamp-1 cursor-pointer" onClick={onClick}>{book.title}</h3>
          <button 
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`p-0.5 transition-colors ${isFavorite ? 'text-red-500' : 'text-gray-300 hover:text-red-200'}`}
          >
            <Heart size={12} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <p className="text-[9px] text-gray-400 line-clamp-1 leading-tight">{book.description}</p>
      </div>
    </motion.div>
  );
}

function SELReportModal({ bookTitle, report, onClose }: { bookTitle: string, report: any, onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-3 overflow-auto">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-xl p-3 md:p-5 max-w-lg w-full text-center space-y-3 shadow-2xl my-2 relative text-left"
      >
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-300 hover:text-gray-500">
          <X size={18} />
        </button>

        <div className="text-center space-y-0.5">
          <div className="bg-blue-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto text-blue-600 rotate-3">
            <Sparkles size={22} />
          </div>
          <h3 className="text-base font-black text-blue-600 mt-1">SEL 歷史報告書</h3>
          <p className="text-gray-400 font-bold text-[9px]">書目：{bookTitle}</p>
          <p className="text-gray-300 text-[8px]">測驗時間：{new Date(report.date).toLocaleString()}</p>
        </div>

        <div className="bg-blue-50/50 p-2.5 rounded-lg border-2 border-blue-100 space-y-1.5">
          <div className="flex items-end justify-between border-b border-blue-100 pb-1">
            <span className="text-blue-800 font-black text-xs">總體表現</span>
            <span className="text-blue-600 font-black text-lg">{report.score}%</span>
          </div>
          <p className="text-blue-700 font-bold leading-relaxed text-[11px]">
            評語：{report.feedback}
          </p>
        </div>

        <div className="space-y-2.5">
          <h4 className="text-[11px] font-black text-gray-500 ml-1">五大核心維度分析</h4>
          <div className="grid grid-cols-1 gap-1.5">
            {Object.entries(report.dimensionScores || report.dimensions || {}).map(([dim, score]: [string, any]) => (
              <div key={dim} className="bg-gray-50 p-3 rounded-xl flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-700">{dim}</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${score}%` }}
                      className="h-full bg-blue-500"
                    />
                  </div>
                  <span className="text-[11px] font-black text-blue-600">{score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button 
          onClick={onClose} 
          className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-black text-base hover:bg-gray-200 transition-all"
        >
          關閉報告
        </button>
      </motion.div>
    </div>
  );
}

function ReadingView({ 
  book, onBack, onPass, isPassed, contentQuizzes, selQuizzes, selIndicators, savedProgress, onSaveProgress, onSaveSELResult,
  isAdmin, onEditQuiz
}: { 
  book: BookData, 
  onBack: () => void, 
  onPass: () => void,
  isPassed: boolean,
  contentQuizzes: QuizQuestion[],
  selQuizzes: QuizQuestion[],
  selIndicators: SELIndicator[],
  savedProgress: any,
  onSaveProgress: (p: any) => void,
  onSaveSELResult: (res: any) => void,
  isAdmin?: boolean,
  onEditQuiz?: (type: 'content' | 'sel') => void
}) {
  const [activeQuizType, setActiveQuizType] = useState<'content' | 'sel' | null>(null);
  const [showProgressPrompt, setShowProgressPrompt] = useState(!!savedProgress);
  const [fontSize, setFontSize] = useState(18);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let currentUrl: string | null = null;
    let isMounted = true;
    
    async function initPdf() {
      if (book.type === 'pdf' && book.fileData) {
        // Reset state
        setPdfUrl(null);
        
        // Ensure valid data URL format if not http
        let targetData = book.fileData;
        if (!targetData.startsWith('http') && !targetData.startsWith('data:')) {
          targetData = `data:application/pdf;base64,${targetData}`;
        }
        
        if (targetData.startsWith('http')) {
          if (isMounted) setPdfUrl(targetData);
          return;
        }

        // Safety timeout for blob conversion (mostly for very slow browser/CPU)
        const safetyTimeout = setTimeout(() => {
          if (isMounted && !currentUrl) {
            setPdfUrl(targetData);
          }
        }, 2000);

        try {
          // fetch on data URL is usually extremely fast
          const res = await fetch(targetData);
          const blob = await res.blob();
          if (isMounted) {
            currentUrl = URL.createObjectURL(blob);
            setPdfUrl(currentUrl);
            clearTimeout(safetyTimeout);
          }
        } catch (e) {
          console.error('PDF fetch conversion failed:', e);
          if (isMounted) {
            setPdfUrl(targetData);
            clearTimeout(safetyTimeout);
          }
        }
      }
    }

    initPdf();

    return () => {
      isMounted = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [book.id, book.fileData]); // Monitor both to catch changes accurately

  useEffect(() => {
    if (!showProgressPrompt && savedProgress) {
      // Apply progress if accepted
      if (book.type === 'video' && videoRef.current) {
        videoRef.current.currentTime = savedProgress;
      } else if (book.type === 'text' && textRef.current) {
        textRef.current.scrollTop = savedProgress;
      }
    }
  }, [showProgressPrompt, savedProgress, book.type]);

  const handleSaveProgress = () => {
    if (book.type === 'video' && videoRef.current) {
      onSaveProgress(videoRef.current.currentTime);
    } else if (book.type === 'text' && textRef.current) {
      onSaveProgress(textRef.current.scrollTop);
    }
    // For PDF/YouTube, we might need different logic or just not track
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-white z-50 flex flex-col"
    >
      <div className="bg-white border-b border-gray-100 px-2 py-1.5 flex items-center justify-between">
        <button onClick={() => { handleSaveProgress(); onBack(); }} className="p-1 hover:bg-gray-100 rounded-full">
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-bold text-sm truncate px-3">{book.title}</h2>
        <div className="w-7"></div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 relative flex">
        {book.type === 'text' && (
          <div 
            ref={textRef}
            style={{ fontSize: `${fontSize}px` }}
            className="flex-1 max-w-2xl mx-auto p-4 md:p-6 bg-white min-h-full shadow-sm leading-relaxed whitespace-pre-wrap font-medium text-gray-700"
          >
            {book.fileData}
          </div>
        )}

        {book.type === 'youtube' && (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <iframe 
              className="w-full aspect-video max-w-4xl"
              src={`https://www.youtube.com/embed/${book.fileData}`}
              title={book.title}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>
          </div>
        )}

        {book.type === 'video' && (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <video 
              ref={videoRef}
              src={book.fileData} 
              controls 
              className="w-full max-h-full"
            ></video>
          </div>
        )}

        {book.type === 'pdf' && (
          <div className="w-full h-full relative bg-gray-100">
            {/* Action Bar */}
            <div className="absolute top-4 right-4 z-[60] flex gap-2">
              {book.fileData && (
                <a 
                  href={pdfUrl || book.fileData} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="bg-indigo-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-xl text-sm font-bold shadow-xl flex items-center gap-2 hover:bg-indigo-700 transition-all border border-indigo-400"
                >
                  <ExternalLink size={16} /> 彈出閱讀
                </a>
              )}
            </div>

            {pdfUrl ? (
              <iframe 
                src={pdfUrl} 
                className="w-full h-full border-none bg-white"
                title={book.title}
                key={pdfUrl} // Force re-render on URL change
              ></iframe>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8 text-center bg-white">
                <div className="relative">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  >
                    <Loader2 className="text-indigo-500" size={64} />
                  </motion.div>
                  <FileText className="absolute inset-0 m-auto text-indigo-300" size={24} />
                </div>
                <div className="space-y-2">
                  <h4 className="font-black text-xl text-gray-800">載入 PDF 內容中...</h4>
                  <p className="text-gray-500 max-w-xs mx-auto text-sm">
                    正在處裡檔案資料，大型檔案可能需要較多系統資源。
                  </p>
                </div>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => setPdfUrl(book.fileData)}
                    className="text-indigo-600 font-bold hover:underline text-sm"
                  >
                    讀取過久？點此嘗試直接顯示
                  </button>
                  
                  {book.fileData && book.fileData.length < 1000 && (
                    <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 text-sm italic">
                      💡 提示：此檔案目前資料量較小 ({Math.round(book.fileData.length / 1024)} KB)，若顯示空白可能是來源損毀。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {showProgressPrompt && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 z-10">
            <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center space-y-4 shadow-2xl">
              <p className="font-bold text-lg">要繼續上次的閱讀進度嗎？</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowProgressPrompt(false)}
                  className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-bold"
                >
                  是，繼續
                </button>
                <button 
                  onClick={() => { onSaveProgress(null); setShowProgressPrompt(false); }}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-500 font-bold"
                >
                  從頭開始
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Font Size Control - Fixed relative to the viewport/modal */}
      <div className="fixed right-4 top-20 flex flex-col items-center gap-2 bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-xl border border-blue-100 z-[60] group ring-4 ring-blue-50/50 transition-all hover:scale-105">
        <div className="text-[10px] font-black text-blue-500 uppercase tracking-tighter [writing-mode:vertical-lr] mb-1">字體大小調整</div>
        <div className="h-32 flex items-center">
            <input 
            type="range" 
            min="14" 
            max="40" 
            value={fontSize} 
            onChange={(e) => setFontSize(parseInt(e.target.value))}
            className="accent-blue-500 cursor-pointer appearance-none bg-blue-50 h-2 rounded-full w-2"
            style={{
              WebkitAppearance: 'slider-vertical',
              height: '120px'
            } as any}
          />
        </div>
        <span className="text-xs font-black text-blue-600 mt-1">{fontSize}</span>
      </div>

      {!activeQuizType && (
        <div className="px-4 py-1.5 bg-white border-t border-gray-100 flex flex-col sm:flex-row justify-center gap-2 items-center">
          <div className="flex flex-col gap-1 flex-1 max-w-[180px]">
            <button 
              onClick={() => setActiveQuizType('content')}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-lg font-black text-[10px] shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95"
            >
              <Award size={12} />
              進行內容測驗
            </button>
            {isAdmin && onEditQuiz && (
              <button 
                onClick={() => onEditQuiz('content')}
                className="w-full text-orange-600 bg-orange-50 hover:bg-orange-100 py-0.5 rounded-md text-[8px] font-bold flex items-center justify-center gap-1 border border-orange-100 transition-all"
              >
                <Edit size={8} /> 管理測驗題目
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1 flex-1 max-w-[180px]">
            <button 
              onClick={() => setActiveQuizType('sel')}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg font-black text-[10px] shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-95"
            >
              <Sparkles size={12} />
              進行 SEL 測驗
            </button>
            {isAdmin && onEditQuiz && (
              <button 
                onClick={() => onEditQuiz('sel')}
                className="w-full text-blue-600 bg-blue-50 hover:bg-blue-100 py-0.5 rounded-md text-[8px] font-bold flex items-center justify-center gap-1 border border-blue-100 transition-all"
              >
                <Edit size={8} /> 管理 SEL 題目
              </button>
            )}
          </div>

          <button 
            onClick={onBack}
            className="flex-shrink-0 bg-gray-100 hover:bg-gray-200 text-gray-500 px-2 py-1 rounded-md font-bold text-[9px] flex items-center justify-center gap-1 transition-all border border-gray-200 h-fit"
          >
            <Home size={12} />
            回首頁
          </button>
        </div>
      )}

      {activeQuizType && (
        <QuizModal 
          type={activeQuizType}
          questions={activeQuizType === 'content' ? contentQuizzes : selQuizzes} 
          bookTitle={book.title}
          selIndicators={selIndicators}
          onClose={() => setActiveQuizType(null)} 
          onPass={(selResult) => { 
            if (activeQuizType === 'content') onPass();
            if (selResult) onSaveSELResult(selResult);
            setActiveQuizType(null); 
          }}
        />
      )}
    </motion.div>
  );
}

function QuizModal({ type, questions, bookTitle, selIndicators, onClose, onPass }: { 
  type: 'content' | 'sel',
  questions: QuizQuestion[], 
  bookTitle: string,
  selIndicators: SELIndicator[],
  onClose: () => void, 
  onPass: (selResult?: any) => void 
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isWrong, setIsWrong] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [responses, setResponses] = useState<any[]>([]);
  const [fontSize, setFontSize] = useState(15); // Reduced default base font size
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [showHintModal, setShowHintModal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleDownloadPDF = async () => {
    if (!reportRef.current || isGeneratingPDF) return;
    
    setIsGeneratingPDF(true);
    try {
      // Small delay to ensure any layout shifts are settled
      await new Promise(resolve => setTimeout(resolve, 1000));

      const reportEl = reportRef.current;
      const originalWidth = reportEl.style.width;
      const originalMaxWidth = reportEl.style.maxWidth;
      
      // Temporarily set a fixed width for consistent capture
      reportEl.style.width = '800px';
      reportEl.style.maxWidth = '800px';

      const canvas = await html2canvas(reportEl, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 800,
        height: reportEl.scrollHeight,
        windowWidth: 850,
        onclone: (clonedDoc) => {
          // Find all style tags and replace oklch with hex/rgb
          const styleTags = clonedDoc.getElementsByTagName('style');
          for (let i = 0; i < styleTags.length; i++) {
            let css = styleTags[i].innerHTML;
            css = css.replace(/oklch\([^)]+\)/g, '#374151'); 
            styleTags[i].innerHTML = css;
          }

          const elements = clonedDoc.querySelectorAll('*');
          elements.forEach((el) => {
            const castEl = el as HTMLElement;
            // Force basic styles to avoid oklch issues during capture
            if (castEl.style.color && castEl.style.color.includes('oklch')) castEl.style.color = '#374151';
            if (castEl.style.backgroundColor && castEl.style.backgroundColor.includes('oklch')) castEl.style.backgroundColor = '#ffffff';
          });

          // Ensure the cloned report also has the fixed width
          const clonedReport = clonedDoc.querySelector('[ref="reportRef"]') as HTMLElement || clonedDoc.body.firstChild as HTMLElement;
          if (clonedReport) {
            clonedReport.style.width = '800px';
            clonedReport.style.margin = '0 auto';
          }
        }
      });
      
      // Restore original styles
      reportEl.style.width = originalWidth;
      reportEl.style.maxWidth = originalMaxWidth;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const margin = 10;
      const contentWidth = pdfWidth - (2 * margin);
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      
      // Calculate ratio to scale image down to contentWidth
      const ratio = contentWidth / (imgWidth / 2); // /2 because scale: 2
      const totalPdfHeightNeeded = (imgHeight / 2) * ratio;
      
      const pxPerPDFPage = (pdfHeight - (2 * margin)) / ratio * 2; // px in original canvas scale
      
      let heightLeft = imgHeight;
      let page = 0;

      while (heightLeft > 0) {
        if (page > 0) pdf.addPage();
        
        const sourceTop = page * pxPerPDFPage;
        const sourceHeight = Math.min(pxPerPDFPage, imgHeight - sourceTop);
        
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = imgWidth;
        pageCanvas.height = Math.ceil(sourceHeight);
        const ctx = pageCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          ctx.drawImage(canvas, 0, sourceTop, imgWidth, sourceHeight, 0, 0, imgWidth, sourceHeight);
          
          const pageImgData = pageCanvas.toDataURL('image/jpeg', 1.0);
          const drawHeight = (sourceHeight / 2) * ratio;
          
          pdf.addImage(pageImgData, 'JPEG', margin, margin, contentWidth, drawHeight);
        }
        
        heightLeft -= sourceHeight;
        page++;
      }

      pdf.save(`SEL_成長報告書_${bookTitle}.pdf`);
      alert('PDF 報告生成完畢！');
    } catch (error) {
      console.error('PDF generation error:', error);
      alert('PDF 生成失敗，請再試一次。');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const quizSet = useMemo(() => {
    // Shuffled all questions instead of slicing to 5
    const shuffled = [...questions].sort(() => 0.5 - Math.random());
    return shuffled;
  }, [questions]);

  // Sync selected option when navigating back/forth
  useEffect(() => {
    const container = scrollRef.current;
    
    const scrollToTop = () => {
      if (container) {
        container.scrollTop = 0;
        // Also try scrollTo for better compatibility
        container.scrollTo({ top: 0, behavior: 'instant' });
      }
    };

    // Try multiple times to ensure we catch layout updates after question changes
    // 0ms, 16ms (RAF), 50ms, 100ms
    scrollToTop();
    const raf = requestAnimationFrame(scrollToTop);
    const t1 = setTimeout(scrollToTop, 50);
    const t2 = setTimeout(scrollToTop, 150);
    
    if (type === 'sel') {
      if (responses[currentIdx]) {
        setSelectedOption(responses[currentIdx].selected);
      } else {
        setSelectedOption(null);
      }
    } else {
      setSelectedOption(null);
    }
    setIsWrong(false);
    
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [currentIdx, type, responses]);

  const handlePrev = () => {
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
    }
  };

  const handleNext = () => {
    const q = quizSet[currentIdx];
    const isCorrect = selectedOption === q.correctAnswer;
    
    // Store response for both types now
    const responseEntry = { 
      question: q.question,
      selected: selectedOption,
      selectedText: q.options[selectedOption!],
      isCorrect,
      correctAnswer: q.correctAnswer,
      correctAnswerText: q.options[q.correctAnswer],
      hint: q.hint,
      score: type === 'content' ? (isCorrect ? 100 : 0) : (q.optionScores ? (q.optionScores[selectedOption!] || 0) : (isCorrect ? 100 : 0)),
      maxScore: 100,
      optionSels: type === 'sel' ? (q.optionSels ? (q.optionSels[selectedOption!] || '') : '') : '',
      questionSelId: type === 'sel' ? q.selIndicatorId : undefined
    };

    const newResponses = [...responses];
    newResponses[currentIdx] = responseEntry;
    setResponses(newResponses);

    if (type === 'content') {
      if (!isCorrect) {
        setIsWrong(true);
      }
      
      if (currentIdx + 1 < quizSet.length) {
        setCurrentIdx(currentIdx + 1);
      } else {
        setIsFinished(true);
      }
    } else {
      // SEL Quiz
      if (currentIdx + 1 < quizSet.length) {
        setCurrentIdx(currentIdx + 1);
      } else {
        setIsFinished(true);
      }
    }
  };

  const contentResults = useMemo(() => {
    if (type !== 'content' || !isFinished) return null;
    const correctCount = responses.filter(r => r.isCorrect).length;
    const totalCount = quizSet.length;
    const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
    return { correctCount, totalCount, accuracy };
  }, [type, isFinished, responses, quizSet.length]);

  const selReport = useMemo(() => {
    if (type !== 'sel' || !isFinished) return null;
    
    const totalScore = responses.reduce((acc, r) => acc + r.score, 0);
    const totalMax = responses.reduce((acc, r) => acc + (r.maxScore || 100), 0);
    const score = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
    
    // Group by dimension
    const dimensionStats: { [dim: string]: { total: number, obtained: number } } = {};
    responses.forEach(res => {
      // 從選項中的文字解析指標代碼，例如 1-1-1
      const codes = res.optionSels?.match(/[1-5]-[1-3]-[1-2]/g) || [];
      // 如果選項沒指標但題目有，則使用補救
      if (codes.length === 0 && res.questionSelId) codes.push(res.questionSelId);

      if (codes.length === 0) {
        const dim = '均衡發展';
        if (!dimensionStats[dim]) dimensionStats[dim] = { total: 0, obtained: 0 };
        dimensionStats[dim].total += res.maxScore;
        dimensionStats[dim].obtained += res.score;
      } else {
        codes.forEach(code => {
          const indicator = selIndicators.find(ind => ind.code === code);
          const dim = indicator?.dimension || '未知領域';
          if (!dimensionStats[dim]) dimensionStats[dim] = { total: 0, obtained: 0 };
          // 平均分配得分到該題涉及的維度 (或者是直接計入，這裡選擇直接計入)
          dimensionStats[dim].total += res.maxScore;
          dimensionStats[dim].obtained += res.score;
        });
      }
    });

    const dimensionScores: { [dim: string]: number } = {};
    Object.keys(dimensionStats).forEach(dim => {
      dimensionScores[dim] = Math.round((dimensionStats[dim].obtained / dimensionStats[dim].total) * 100);
    });

    // Enhanced feedback logic
    const sortedDims = Object.entries(dimensionScores)
      .filter(([dim]) => dim !== '均衡發展' && dim !== '未知領域')
      .sort((a, b) => b[1] - a[1]);

    const topDim = sortedDims[0]?.[0];
    const lowDim = sortedDims[sortedDims.length - 1]?.[0];

    const encouragementMap: { [key: string]: string } = {
      '第一維度：自我覺察': "孩子，你在自我覺察方面的表現非常亮眼！這代表你擁有一雙敏銳的眼睛，能夠洞察自己內心的微小情緒波動。這種能力就像是擁有一面神聖的靈魂之鏡，能讓你在成長的道路上不斷反思與進步。你要知道，每個人都有情緒，但能像你這樣冷靜地觀察並理解它們，是一項非常了不起的成就。請繼續珍惜這份細膩的天賦，因為懂得愛自己、了解自己，就是通往智慧人生的第一步。你的內心世界是如此豐富多采，每一次的自我覺察都是磁場的提升，讓你變得更加成熟與自信！",
      '第二維度：自我管理': "你在自我管理上展現了驚人的定力！這就像是在洶湧的大海中，你始終能穩穩地握住自己情緒的小船舵，不被風浪所左右。能夠控制自己的反應而不被衝動驅使，是成為一名優秀領袖的核心條件。這種自律的精神，會讓你在未來的學習與生活中，比別人更冷靜地處理難題。你要為自己感到驕傲，因為你能駕馭自己的情緒，而不是被情緒奴役。請繼續保持這種平穩的心態，無論遇到什麼困難，你那強大的內在控制力都將是你最堅強的護盾，引領你走向平穩而美好的未來。",
      '第三維度：社會覺察': "你的一顆仁慈與體貼之心，讓我們深受感動！在社會覺察的過程中，你展現了超乎同齡人的真誠與同理心。你總能敏銳地捕捉到身邊夥伴的喜怒哀樂，並願意站在對方的立場去思考問題，這是一種最高尚的智慧。這個世界非常需要像你這樣溫暖的人，因為你能在乾涸的地方撒下友誼的種子。當你懂得去關懷他人、理解社會的多樣性時，你的世界也會因此變得寬闊無比。請繼續發揮這份體察人心的純真力量，你就是周圍人生命中的一道暖陽，照亮了每個人的心靈角落。",
      '第四維度：人際技巧': "你在人際互動與團隊協作中簡直是太棒了！你展現了卓越的溝通魅力，知道如何與同伴互補長短、互相扶持。在現今的社會裡，懂得與他人共創價值是一項及其關鍵的能力。你那充滿善意的互動方式，讓身邊的人都感到安全與被尊重，大家都特別喜歡與你共事或交朋友。你要繼續發揚這種包容與合作的精神，因為當大家心連心在一起時，沒有什麼難題是克服不了的。你的社交智慧將會是你一生的財富，讓你在任何群體中都能脫穎而出，成為那個最受歡迎、最能激發團隊潛力的閃亮新星！",
      '第五維度：負責任的決定': "你的每個選擇都展現了遠見與智慧！在面對困難的十字路口時，你能夠權衡輕重，並做出了既符合正義又充滿同理心的決定，這展現了超越年齡的成熟判斷力。一個負責任的人，不僅是對自己負責，更是對身邊的一切負責。你懂得分析因果關係，選擇那條最正確、最良善的道路，這是人格高度的體現。請對自己的判斷力充滿信心，因為你擁有一顆清明的心和正確的價值觀。這份承擔責任的勇氣，將會引導你成為一個正能量的典範，在未來的每一場考驗中都能交出最輝煌的答卷。"
    };

    const suggestionMap: { [key: string]: string } = {
      '第一維度：自我覺察': "為了讓你這面心靈之鏡更加明亮，建議你每天花十分鐘進行『心靈深呼吸』練習。找一個安靜的角落坐下來，閉上雙眼，靜靜地觀察你的呼吸如何進出，那一刻你的心裡在想些什麼？不要去評判那些想法，只是像看白雲飄過一樣看著它們。此外，你也可以開始撰寫簡易的『情緒日記』，用畫畫或文字記錄下這一天中最高興與最挑戰的時刻。透過這種日常的沈澱，你會發現自己內心的寶藏越來越多，對自己的掌握感會越來越強，這份深刻的覺知將成為你最強大的內心指南針，引導你做出最真實的選擇。",
      '第二維度：自我管理': "當你感到憤怒或焦慮的火苗快要燃起時，請記住強大的『三秒鐘魔法暫停』。這三秒鐘不是浪費，而是給你強大大腦一個『重新冷卻』的黃金時間。在心裡慢慢數一、二、三，同時深吸一口氣，你會發現那股衝動的巨浪會瞬間變小。此外，你可以練習建立自己的『情緒工具箱』，裡面可以裝載你喜歡的音樂、一張笑臉照或是一個溫暖的擁抱回憶。每當感覺不適時，就打開這個工具箱。透過不斷的練習，你對自我情緒的掌控力會達到一個全新的高度，讓你無論何時都能保持優雅與從容，成為那個掌握心靈鑰匙的小主人。",
      '第三維度：社會覺察': "為了讓你的同理心翅膀飛得更高，你可以多練習『心靈換位思考』的遊戲。當你看到同學或家人心情不好時，試著在腦海中想像：『如果我是他，我現在最希望聽到什麼話？我最害怕什麼？』。這就像是一場有趣的偵探遊戲，幫助你破解別人內心的密碼。你也多閱讀描繪不同文化、不同背景人物的故事書，這會極大地擴展你的心理視野。參與志願服務或幫助弱勢小動物也是極好的方式。這份博大的胸懷將帶領你走向更廣大的世界，讓你擁有一雙能看見美的眼睛，以及一顆能夠感應幸福的心靈。",
      '第四維度：人際技巧': "想要成為人際關係中的大師，你可以從修煉『積極傾聽的神功』開始。當別人在說話時，嘗試完全不打斷，用眼神真誠地看著對方，並在最後用一句話摘要對方的話語，這會讓對方感受到被無比地尊重與理解。同時，你可以學習『非暴力溝通法』，多使用『我感覺...是因為我需要...』這樣的句式，而不是直接批評。在團隊合作中，主動發現夥伴的優點並毫不吝嗇地給予讚美，這會讓你成為團隊中的黏合劑。只要你持續散發善意與真誠，你的社交圈將會像花朵盛開一樣，吸引所有美好的事物來到你的身邊。",
      '第五維度：負責任的決定': "為了讓你的判斷力更加精進，每次做重要決定前，可以試著畫出一張『決策小島圖』。在紙的一邊寫下這個決定會帶來的快樂結果，另一邊寫下可能面臨的挑戰結果，最後在中間寫下你內心最真實的聲音。這種視覺化的思考，能幫你從紛亂的思緒中抽離，做出最理性的抉擇。同時，你可以給自己找一位『人生的心靈導師』，可以是父母、老師或你崇拜的英雄，多請教他們在面對抉擇時的思考過程。這種智慧的傳承會讓你避開很多坑洞。記住，勇於為自己的決定負責的人，就是這個時代真正的超級英雄！"
    };

    let feedback = "繼續加油！多讀書會讓你更了解自己與他人。";
    if (score >= 90) feedback = "卓越表現！你已經具備了領導者般的社會情緒素養，令人驚艷！你對自我與他人的覺察達到了非常高的水平，這是未來通往成功的關鍵奠石。";
    else if (score >= 80) feedback = "太棒了！你非常擅長觀察情緒與做決定，是個高情商的小博士！你的判斷充滿了溫暖與正面的能量，這對周圍的人是非常好的榜樣。";
    else if (score >= 65) feedback = "做得好！你已經具備不錯的情緒力與社交力，再接再厲。只要再多一點點的耐心與反思，你一定能成為情緒管理的小達人！";

    // 逐題解析 (Item-by-item analysis)
    let analysis = "";
    if (responses.length > 0) {
      analysis = responses.map((res, i) => {
        const questionBrief = res.question.length > 25 ? res.question.substring(0, 25) + '...' : res.question;
        const selectedText = res.selectedText || "你的選擇";
        let comment = "";
        
        // Detailed item analysis
        if (res.score >= 90) {
          comment = "你的判斷力令人驚艷，這不僅顯示了你對當前情境的透徹理解，更反映出你內心深處那份自然流露的正直與善良。這種能夠在衝突中尋求冷靜並做出溫暖選擇的能力，是你最寶貴的天賦。請務必珍惜這份敏銳的同理心，它將是你未來連結他人與成就自我的重要羅盤。";
        } else if (res.score >= 70) {
          comment = "你的選擇展現了非常平衡的思考邏輯。你在兼顧自己需求的同時，也細心地考慮到了周遭夥伴的感受。這是一種非常實用且難能可貴的社交智慧，代表你在處理複雜的人際互動時，已經具備了足夠的彈性與包容力。這是一份溫柔且強大的力量。";
        } else if (res.score >= 40) {
          comment = "你正在經歷一個非常棒的學習過程！在這個情境下，你勇於表達自己的直覺想法，這就是進步的起點。雖然有些細微的情緒可以再更深度地去品味與察覺，但你的真實感是你最大的資產。讓我們試著換個角度，去探尋其他選項背後所隱含的細膩與貼心，你將會發現更多驚奇的心靈風景。";
        } else {
          comment = "成長的道路有時會出現轉向，而這正是我們變得更強壯的契機。這個情境對你來說可能稍具挑戰性，但沒關係，能夠發現問題就是解決問題的第一步。下次當類似的情境發生時，試著先停下來深呼吸三次，在心裡想像別人的表情，你一定能找到那個更圓滿、更讓大家感到幸福的方法！";
        }

        return `【問題 ${i + 1}：${questionBrief}】\n➤ 你的選擇：「${selectedText}」\n💡 導師觀點：${comment}`;
      }).join("\n\n");
    } else {
      analysis = "你的表現展現了良好的全面發展潛力。我們期待看到你在各個維度更進一步的成長與蛻變。";
    }

    // Ensure total logic length > 200 characters easily
    const padding = "\n\n✨ 成長悄悄話：在整體的測試過程中，我們觀察到你面對變換多端的情境時，能維持一顆好奇且認真的心。這種主動學習與積極參與的態度，是我們最想看到的成長養分。每一道題目的思考，都是在為你的『情緒肌肉』進行鍛鍊，讓你在面對現實世界的挑戰時，能更加從容自主、充滿光芒！";
    if (analysis.length < 200) analysis += padding;

    const encouragement = topDim ? encouragementMap[topDim] || "每一份努力都正在讓你成為更好的自己，保持這份熱情！你是最棒的成長者。" : "每一份努力都正在讓你成為更好的自己，保持這份熱情！你是最棒的成長者。";
    const suggestions = lowDim ? suggestionMap[lowDim] || "多讀書、多與他人交流，會讓你的心靈視野更開闊。心靈的成長是永無止境的旅程。" : "繼續保持現在的學習態度，你已經走在正確的道路上了！心靈的成長是永無止境的旅程。";

    return { score, dimensionScores, feedback, analysis, encouragement, suggestions, responses };
  }, [type, isFinished, responses, selIndicators]);

  if (quizSet.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-5 max-w-sm w-full text-center space-y-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${type === 'content' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-lg font-bold">還沒有測驗喔！</h3>
          <p className="text-gray-500 text-sm">管理者尚未為這本書建立{type === 'content' ? '內容' : 'SEL'}測驗。</p>
          <button onClick={onClose} className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-bold text-sm">先跳過</button>
        </div>
      </div>
    );
  }

  if (isFinished) {
    const res = contentResults;
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-start justify-center p-2 md:p-4 overflow-y-auto">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-xl p-3 md:p-5 max-w-md w-full text-center space-y-3 shadow-2xl mt-0 mb-3"
        >
          {type === 'content' && res ? (
            <motion.div key="content-results-panel" className="space-y-4">
              <div className="space-y-2">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto shadow-inner ${res.accuracy >= 80 ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                  {res.accuracy >= 80 ? <Award size={40} /> : <BookOpen size={40} />}
                </div>
                <h3 className={`text-xl font-black ${res.accuracy >= 80 ? 'text-green-600' : 'text-orange-600'}`}>
                  {res.accuracy >= 80 ? '故事解密成功！' : '繼續努力喔！'}
                </h3>
                <div className="flex justify-center gap-5 py-0.5">
                  <div className="text-center">
                    <p className="text-gray-400 text-[9px] font-bold uppercase tracking-widest">答對題數</p>
                    <p className="text-base font-black text-gray-800">{res.correctCount} / {res.totalCount}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-gray-400 text-[9px] font-bold uppercase tracking-widest">正確率</p>
                    <p className={`text-base font-black ${res.accuracy >= 80 ? 'text-green-600' : 'text-orange-600'}`}>{res.accuracy}%</p>
                  </div>
                </div>
                <p className="text-gray-500 font-medium text-xs max-w-sm mx-auto leading-relaxed">
                  {res.accuracy >= 80 
                    ? '太棒了！你非常仔細地讀完了這本書，並掌握了故事細節！' 
                    : '再讀一次故事，你一定能發現更多小秘密！'}
                </p>
              </div>

              {/* Question Review Section */}
              <div className="text-left space-y-2">
                <h4 className="font-black text-gray-400 text-[9px] uppercase tracking-[0.2em] px-1 flex items-center gap-1.5">
                  <MessageCircle size={10} />
                  測驗內容回顧
                </h4>
                <div className="space-y-2">
                  {responses.map((r, i) => (
                    <div key={i} className={`p-2.5 rounded-xl border transition-all ${r.isCorrect ? 'bg-green-50/30 border-green-100' : 'bg-red-50/30 border-red-100'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[8px] font-black text-gray-400 uppercase tracking-wider">問題 {i + 1}</span>
                        {r.isCorrect ? (
                          <span className="bg-green-100 text-green-600 px-1 py-0.5 rounded-full text-[8px] font-black">正確</span>
                        ) : (
                          <span className="bg-red-100 text-red-600 px-1 py-0.5 rounded-full text-[8px] font-black">答錯</span>
                        )}
                      </div>
                      <p className="font-bold text-gray-800 text-xs mb-1 leading-relaxed">{r.question}</p>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="text-gray-400 font-bold shrink-0">你的回答：</span>
                          <span className={r.isCorrect ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{r.selectedText}</span>
                        </div>
                        {!r.isCorrect && (
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="text-orange-500 font-bold shrink-0">正確答案：</span>
                            <span className="text-orange-600 font-bold">{r.correctAnswerText}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 pt-3 border-t border-gray-100">
                <button 
                  onClick={() => onPass()} 
                  className={`w-full py-2.5 rounded-lg font-black text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                    res.accuracy >= 80 
                    ? 'bg-green-500 text-white shadow-green-100 hover:bg-green-600' 
                    : 'bg-orange-500 text-white shadow-orange-100 hover:bg-orange-600'
                  }`}
                >
                  <Award size={18} />
                  {res.accuracy >= 80 ? '領取榮譽勳章' : '領取參與獎勵'}
                </button>
                <div className="grid grid-cols-2 gap-1.5">
                  <button 
                    onClick={() => {
                      setCurrentIdx(0);
                      setResponses([]);
                      setIsFinished(false);
                      setSelectedOption(null);
                    }}
                    className="py-2.5 bg-orange-100 text-orange-600 rounded-lg font-black text-xs hover:bg-orange-200 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw size={16} />
                    再測一次
                  </button>
                  <button 
                    onClick={onClose}
                    className="py-2.5 bg-gray-100 text-gray-600 rounded-lg font-black text-xs hover:bg-gray-200 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                  >
                    <Home size={16} />
                    回到首頁
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="sel-results-panel" className="space-y-3 text-left">
              <div ref={reportRef} className="bg-white p-1.5 space-y-3" style={{ backgroundColor: '#ffffff' }}>
                <div className="text-center space-y-0.5 pb-1">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto rotate-3" style={{ backgroundColor: '#DBEAFE', color: '#2563EB' }}>
                    <Sparkles size={24} />
                  </div>
                  <h3 className="text-base font-black mt-1.5" style={{ color: '#2563EB' }}>SEL 成長報告書</h3>
                  <p className="font-bold text-[10px]" style={{ color: '#9CA3AF' }}>書目：{bookTitle}</p>
                </div>

                <div className="p-3 rounded-[20px] border-2 space-y-2 mb-1.5" style={{ backgroundColor: 'rgba(239, 246, 255, 0.5)', borderColor: '#DBEAFE' }}>
                  <div className="flex items-end justify-between border-b pb-1" style={{ borderColor: '#DBEAFE' }}>
                    <span className="font-black text-sm" style={{ color: '#1E40AF' }}>總體表現</span>
                    <span className="font-black text-lg" style={{ color: '#2563EB' }}>{selReport?.score}%</span>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-bold leading-relaxed text-xs" style={{ color: '#1D4ED8' }}>
                      評語：{selReport?.feedback}
                    </p>
                    <div className="p-2.5 rounded-lg text-[10px] space-y-1 border" style={{ backgroundColor: 'rgba(255, 255, 255, 0.6)', borderColor: '#EFF6FF' }}>
                      <p className="font-bold tracking-wider">【 深度分析 】</p>
                      <p className="font-medium leading-relaxed whitespace-pre-line" style={{ color: '#4B5563' }}>{selReport?.analysis}</p>
                      <p className="font-black tracking-wider pt-0.5" style={{ color: '#2563EB' }}>【 成長勵志 】</p>
                      <p className="font-medium italic" style={{ color: '#4B5563' }}>「{selReport?.encouragement}」</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 pb-3">
                  <h4 className="text-[10px] font-black ml-1" style={{ color: '#6B7280' }}>核心維度分析</h4>
                  <div className="grid grid-cols-1 gap-1">
                    {selReport && Object.entries(selReport.dimensionScores).map(([dim, score]) => (
                      <div key={dim} className="p-2.5 rounded-lg flex items-center justify-between" style={{ backgroundColor: '#F9FAFB' }}>
                        <span className="text-[10px] font-bold" style={{ color: '#374151' }}>{dim}</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1 rounded-full overflow-hidden" style={{ backgroundColor: '#E5E7EB' }}>
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${score}%` }}
                              className="h-full"
                              style={{ backgroundColor: '#3B82F6' }}
                            />
                          </div>
                          <span className="text-[10px] font-black" style={{ color: '#2563EB' }}>{score}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Additional details for PDF */}
                <div className="pt-3 border-t space-y-2 pb-4 text-[10px]" style={{ borderColor: '#F3F4F6' }}>
                  <h4 className="font-black ml-1" style={{ color: '#6B7280' }}>詳細作答記錄</h4>
                  <div className="space-y-1.5">
                    {responses.slice(0, 5).map((res, i) => (
                      <div key={i} className="border p-2 rounded-lg space-y-0.5" style={{ backgroundColor: '#ffffff', borderColor: '#F3F4F6', borderWidth: '1px' }}>
                        <p className="font-bold" style={{ color: '#1F2937' }}>問題 {i+1}：{res.question.length > 25 ? res.question.substring(0, 25) + '...' : res.question}</p>
                        <p className="font-medium" style={{ color: '#2563EB' }}>你的選擇：{res.selectedText}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex flex-col sm:flex-row gap-1.5">
                  <button 
                    onClick={() => onPass(selReport)} 
                    className="flex-[2] py-2.5 bg-blue-600 text-white rounded-lg font-black text-sm shadow-md shadow-blue-50 hover:bg-blue-700 transition-all active:scale-[0.98]"
                  >
                    儲存 SEL 紀錄
                  </button>
                  <button 
                    onClick={handleDownloadPDF}
                    disabled={isGeneratingPDF}
                    className={`flex-1 py-2.5 bg-white border-2 border-blue-600 text-blue-600 rounded-lg font-black text-sm shadow-sm transition-all flex items-center justify-center gap-1.5 ${isGeneratingPDF ? 'opacity-50 cursor-wait' : 'hover:bg-blue-50'}`}
                  >
                    {isGeneratingPDF ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Download size={16} />
                    )}
                    PDF
                  </button>
                </div>
                <button 
                  onClick={onClose}
                  className="w-full py-2 bg-gray-100 text-gray-500 rounded-lg font-bold text-[11px] hover:bg-gray-200 transition-all"
                >
                  回首頁
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  const currentQ = quizSet[currentIdx];

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden flex items-center justify-center">
      {/* Background with blur - Fixed and non-scrolling */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-md" 
        onClick={onClose}
      />

      {/* Font Size Control - Fixed relative to screen */}
      <div className="fixed right-2 top-2 md:right-4 md:top-4 flex flex-col items-center gap-2 bg-white/95 backdrop-blur-md p-2 rounded-2xl shadow-2xl border border-blue-100 z-[70] transition-transform hover:scale-105 ring-4 ring-blue-50/50">
        <div className="text-[10px] font-black text-blue-500 uppercase tracking-tighter [writing-mode:vertical-lr] mb-1">字體大小調整</div>
        <div className="h-32 flex items-center">
            <input 
            type="range" 
            min="14" 
            max="40" 
            value={fontSize} 
            onChange={(e) => setFontSize(parseInt(e.target.value))}
            className="accent-blue-500 cursor-pointer appearance-none bg-blue-50 h-2 rounded-full w-2"
            style={{
              WebkitAppearance: 'slider-vertical',
              height: '120px'
            } as any}
          />
        </div>
        <span className="text-sm font-black text-blue-600 mt-1">{fontSize}</span>
      </div>

      {/* Scrollable container for question content */}
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto px-4 py-2 md:py-4 flex justify-center items-start">
        <motion.div 
          key={currentIdx}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 0 }}
          animate={isWrong ? { x: [-10, 10, -10, 10, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
          transition={{ 
            x: isWrong ? { type: "keyframes", duration: 0.4 } : { type: "spring", damping: 25, stiffness: 400 },
            default: { type: "spring", damping: 25, stiffness: 400 }
          }}
          className="bg-white rounded-3xl p-6 max-w-2xl w-full space-y-5 shadow-2xl mt-0 mb-4 relative"
        >
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-300 hover:text-gray-500">
          <X size={24} />
        </button>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${type === 'content' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                {type === 'content' ? '故事挑戰' : '心情情境'}
              </span>
              <p className="text-gray-400 font-bold text-xs">問題 {currentIdx + 1} / {quizSet.length}</p>
            </div>
            {currentQ.hint && (
              <button 
                onClick={() => setShowHintModal(true)}
                className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-[10px] font-black hover:bg-yellow-200 transition-all flex items-center gap-1 shadow-sm border border-yellow-200"
              >
                <Lightbulb size={12} />
                溫馨提示
              </button>
            )}
          </div>

          <h3 
            className="font-bold text-gray-800 leading-relaxed"
            style={{ fontSize: `${fontSize - 2}px` }}
          >
            {currentQ.question}
          </h3>
          
          <AnimatePresence>
            {isWrong && currentQ.hint && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-yellow-50 p-3 rounded-xl border-2 border-yellow-100 flex items-start gap-2"
              >
                <Sparkles className="text-yellow-500 shrink-0 mt-0.5" size={14} />
                <p className="text-[10px] text-yellow-700 font-medium leading-relaxed">
                  <span className="font-bold">溫馨小提示：</span>{currentQ.hint}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-1.5">
          {currentQ.options.map((opt, i) => opt.trim() ? (
            <button 
              key={i}
              onClick={() => setSelectedOption(i)}
              className={`w-full text-left px-4 py-2 rounded-xl font-bold transition-all border-2 leading-tight ${
                selectedOption === i 
                  ? (type === 'content' ? 'bg-orange-50 border-orange-400 text-orange-600' : 'bg-blue-50 border-blue-400 text-blue-600 shadow-inner')
                  : 'bg-gray-50 border-transparent text-gray-600 hover:bg-gray-100'
              }`}
              style={{ fontSize: `${fontSize - 2}px` }}
            >
              <div className="flex gap-2">
                <span className="shrink-0 text-gray-400 font-mono tracking-tighter">{String.fromCharCode(65 + i)}</span>
                <span className="text-[13px]">{opt}</span>
              </div>
            </button>
          ) : null)}

          <div className="flex gap-3 mt-2">
            {currentIdx > 0 && (
              <button 
                onClick={handlePrev}
                className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all font-sans"
              >
                上一題
              </button>
            )}
            <button 
              onClick={handleNext}
              disabled={selectedOption === null}
              className={`flex-[2] py-2 text-white rounded-xl font-bold text-sm shadow-md disabled:opacity-50 transition-all font-sans ${
                type === 'content' ? 'bg-orange-500 shadow-orange-100' : 'bg-blue-600 shadow-blue-100'
              }`}
            >
              {currentIdx + 1 === quizSet.length ? '結果分析' : '下一題'}
            </button>
          </div>
        </div>
      </motion.div>
      </div>

      {/* Hint Modal Overlay */}
      <AnimatePresence>
        {showHintModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 outline-none">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowHintModal(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center space-y-5 relative z-[110] border-t-8 border-yellow-400"
            >
              <button 
                onClick={() => setShowHintModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={20} />
              </button>
              <div className="text-center space-y-4">
                <div className="bg-yellow-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-yellow-600 shadow-inner">
                  <Lightbulb size={32} />
                </div>
                <h3 className="text-xl font-black text-gray-800 tracking-tight">溫馨提示</h3>
                <p className="text-gray-600 font-medium leading-relaxed bg-yellow-50/50 p-4 rounded-2xl border border-yellow-100">
                  {currentQ.hint}
                </p>
                <button 
                  onClick={() => setShowHintModal(false)}
                  className="w-full py-3.5 bg-yellow-500 text-white rounded-2xl font-black shadow-lg shadow-yellow-100 hover:bg-yellow-600 transition-all active:scale-[0.98]"
                >
                  我知道了
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminView({ books, selIndicators, onBack, authError, isAdmin, firebaseUser, onEditQuiz, onDeleteBook, showAttendance, onToggleAttendance }: { 
  books: BookData[], 
  selIndicators: SELIndicator[],
  onBack: () => void,
  authError?: string | null,
  isAdmin: boolean,
  firebaseUser: FirebaseUser | null,
  onEditQuiz: (bookId: string, type: 'content' | 'sel') => void,
  onDeleteBook: (id: string, title: string) => void,
  showAttendance?: boolean,
  onToggleAttendance?: () => void
}) {
  const [adminTab, setAdminTab] = useState<'books' | 'sel'>('books');
  const [editingBook, setEditingBook] = useState<Partial<BookData> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingSel, setEditingSel] = useState<Partial<SELIndicator> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!firebaseUser) {
      alert("⚠️ 雲端功能受限！\n請確保您已使用管理員帳號登入，或 Firebase 已開啟「匿名登入 (Anonymous Auth)」。\n目前的狀態無法執行寫入動作。");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
      complete: async (results) => {
        const data = results.data as any[];
        console.log("Parsed CSV data:", data);
        if (data.length === 0) {
          alert("❌ CSV 檔案內容為空或解析失敗");
          return;
        }
        
        if (!confirm(`偵測到 ${data.length} 筆指標，即將匯入資料庫，確定嗎？`)) return;
        
        setIsProcessing(true);
        try {
          const batch = writeBatch(db);
          let count = 0;
          
          data.forEach((row: any) => {
            const keys = Object.keys(row);
            
            // Helper to find column by multiple possible names
            const getVal = (keywords: string[], index: number) => {
              const exact = keys.find(k => keywords.includes(k));
              if (exact) return row[exact];
              const partial = keys.find(k => keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase())));
              if (partial) return row[partial];
              return row[keys[index]];
            };

            const dimension = getVal(['維度', 'Dimension', '資料庫中維度名稱'], 0);
            const code = getVal(['編號', 'Code', '指標編號', 'ID'], 1);
            const subDomain = getVal(['子面向', 'Sub-domain', '評量細項'], 2);
            const description = getVal(['描述', 'Description', '行為指標描述', '測驗重點'], 3);
            const weight = getVal(['權重', 'Weight', '建議權重'], 4);

            if (code && String(code).trim()) {
              const docId = String(code).trim().replace(/\//g, '_'); // Replace slashes to avoid subcollection issues
              const docRef = doc(collection(db, 'sel_indicators'), docId);
              batch.set(docRef, cleanData({
                dimension: String(dimension || '未分類').trim(),
                code: String(code).trim(),
                subDomain: String(subDomain || '').trim(),
                description: String(description || '').trim(),
                weight: String(weight || '0%').trim()
              }));
              count++;
            }
          });

          if (count === 0) {
            alert("❌ 找不到有效的指標編號 \n請確認 CSV 檔案包含「編號」或「指標編號」等欄位，或確保第二欄是編號。");
            setIsProcessing(false);
            return;
          }

          await batch.commit();
          alert(`✅ 成功匯入 ${count} 筆指標！ \n系統正在同步數據，請稍等 1-2 秒即可在列表看到內容。`);
          console.log("Batch commit successful for", count, "items");
        } catch (error) {
          console.error("CSV Import Error:", error);
          handleFirestoreError(error, OperationType.WRITE, 'sel_indicators');
          alert("匯入失敗: " + (error instanceof Error ? error.message : "未知錯誤"));
        } finally {
          setIsProcessing(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    });
  };

  const handleUpdateSELDocument = async () => {
    setIsProcessing(true);
    try {
      const content = selIndicators.map(ind => 
        `[${ind.dimension}] ${ind.code} ${ind.subDomain}: ${ind.description} (權重: ${ind.weight})`
      ).join('\n');
      
      await setDoc(doc(db, 'system', 'sel_standard'), cleanData({
        name: 'sel評量指標',
        content,
        updatedAt: serverTimestamp()
      }));
      alert("SEL 評量指標文檔已更新！此內容將作為 AI 生成試題的參考標準。");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'system/sel_standard');
      alert("文檔更新失敗");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSeedSEL = async () => {
    setIsProcessing(true);
    console.log("Seeding SEL Indicators...", INITIAL_SEL_INDICATORS.length);
    try {
      const batch = writeBatch(db);
      INITIAL_SEL_INDICATORS.forEach(indicator => {
        const docRef = doc(collection(db, 'sel_indicators'), indicator.code);
        batch.set(docRef, cleanData(indicator));
      });
      await batch.commit();
      alert(`✅ 成功存入 ${INITIAL_SEL_INDICATORS.length} 筆預設評量指標！`);
    } catch (error) {
      console.error("Seed Error:", error);
      handleFirestoreError(error, OperationType.WRITE, 'sel_indicators');
      alert("匯入失敗，請檢查權限");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveSEL = async (indicator: SELIndicator) => {
    if (!auth.currentUser) {
      alert("⚠️ 目前無法同步到雲端！\n請啟用 Firebase 匿名登入功能。");
      return;
    }
    setIsProcessing(true);
    try {
      const id = indicator.id || indicator.code;
      await setDoc(doc(db, 'sel_indicators', id), cleanData(indicator));
      alert("✅ SEL 指標儲存完成！");
      setEditingSel(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `sel_indicators/${indicator.code}`);
      alert("儲存失敗");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSEL = async (id: string) => {
    if (!confirm('確定要刪除此評量指標嗎？')) return;
    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'sel_indicators', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `sel_indicators/${id}`);
      alert("刪除失敗");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddBook = () => {
    setEditingBook({
      title: '',
      author: '童書作者',
      description: '',
      coverImageUrl: '',
      type: 'text',
      fileData: '',
      keywords: [],
    });
  };

  const handleSaveBook = async (book: BookData) => {
    if (!auth.currentUser) {
      alert("⚠️ 目前無法同步到雲端！\n因您的 Firebase 專案未啟用「匿名登入」，目前的修改僅存於本機。請啟用 Anonymous Auth 後再試。");
      return;
    }
    setIsProcessing(true);
    try {
      const id = book.id || doc(collection(db, 'kidsbook-GitHub-to-Firebase')).id;
      const data = { ...book, id, createdAt: book.createdAt || Date.now() };
      await setDoc(doc(db, 'kidsbook-GitHub-to-Firebase', id), cleanData(data));
      alert("✅ 圖書儲存成功！");
      setEditingBook(null); // 跳回書單介面
    } catch (error: any) {
      console.error(error);
      const errObj = error.message.startsWith('{') ? JSON.parse(error.message) : null;
      const isPermissionErr = errObj?.error?.includes('permission') || error.message.includes('permission');
      
      let msg = "儲存失敗，請檢查權限及欄位格式。";
      if (isPermissionErr) {
        msg = `⚠️ 權限不足！請確保您的 UID 已加入 Firebase 的 admins 集合中。\n您的 UID: ${auth.currentUser?.uid}`;
      }
      alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Auth Status Notification */}
      {(!auth.currentUser || authError) && (
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-yellow-50 border-2 border-yellow-200 p-6 rounded-[32px] flex items-start gap-4 shadow-sm"
        >
          <div className="w-12 h-12 bg-yellow-100 rounded-2xl flex items-center justify-center text-yellow-600 shrink-0">
            <AlertTriangle size={24} />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-yellow-800 text-lg">⚠️ 權限檢查中或雲端同步中</h4>
            <p className="text-yellow-700 text-sm leading-relaxed font-medium">
              目前的登入身分為：<span className="bg-yellow-100 px-1 rounded">{isAdmin ? '管理者' : firebaseUser?.isAnonymous ? '匿名使用者' : '一般使用者'}</span>。
            </p>
            <p className="text-yellow-600 text-xs mt-1">
              若您已是管理者但仍看到此訊息，請確認您的 UID 已在 Firebase Rules 或 admins 集合中。
            </p>
            <div className="flex gap-4 mt-3">
              <button 
                onClick={() => window.location.reload()}
                className="text-yellow-800 underline text-sm font-black hover:text-yellow-900 transition-colors"
              >
                重新整理頁面
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tab Switcher */}
      <div className="flex bg-gray-100 p-1 rounded-2xl w-fit">
        <button 
          onClick={() => setAdminTab('books')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${adminTab === 'books' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-500'}`}
        >
          圖書管理
        </button>
        <button 
          onClick={() => setAdminTab('sel')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${adminTab === 'sel' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
        >
          SEL 評量指標管理
        </button>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-gray-800">
          {adminTab === 'books' ? '📚 圖書後台管理' : '🎯 SEL 評量指標維護'}
        </h2>
        <div className="flex gap-2">
          {adminTab === 'books' ? (
            <>
              <button 
                onClick={onToggleAttendance}
                className={`px-4 py-2.5 rounded-xl flex items-center gap-2 font-bold transition-all text-sm border-2 ${showAttendance ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100'}`}
                title="點名計算器"
              >
                <CheckCircle size={18} /> 點名計算器
              </button>
              <button 
                onClick={handleAddBook}
                className="bg-orange-500 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-bold shadow-lg shadow-orange-100 hover:bg-orange-600 transition-all text-sm"
              >
                <Plus size={18} /> 新增書籍
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={handleSeedSEL}
                className="bg-blue-100 text-blue-600 px-4 py-2.5 rounded-xl font-bold hover:bg-blue-200 transition-all text-sm"
                title="匯入系統預設的 21 項 SEL 指標"
              >
                <Sparkles size={18} /> 預設指標
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 bg-purple-100 text-purple-600 px-4 py-2.5 rounded-xl font-bold hover:bg-purple-200 transition-all border-2 border-purple-200 text-sm"
                title="從 CSV 檔案匯入評量指標"
              >
                <FileSpreadsheet size={18} /> 匯入 CSV
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleCSVImport} 
                accept=".csv" 
                className="hidden" 
              />
              <button 
                onClick={() => setEditingSel({ dimension: '第一維度：自我覺察', code: '', subDomain: '', description: '', weight: '' })}
                className="bg-blue-600 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all text-sm"
              >
                <Plus size={18} /> 新增指標
              </button>
            </>
          )}
          <button onClick={onBack} className="p-3 text-gray-400 hover:bg-gray-100 rounded-2xl transition-colors">
            <X size={24} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-gray-100 overflow-hidden shadow-sm">
        <AnimatePresence mode="wait">
          {showAttendance ? (
            <motion.div 
              key="attendance-calculator"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-purple-50/50 p-6 border-b-2 border-gray-100"
            >
              <AttendanceCalculator />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {adminTab === 'books' ? (
          <div className="divide-y-2 divide-gray-50">
            {books.map(book => (
              <div key={book.id} className="flex items-center gap-6 p-6 hover:bg-gray-50 transition-colors group">
                <div className="w-16 h-20 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0 shadow-inner">
                  <img src={book.coverImageUrl || DEFAULT_COVER} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-800 text-lg truncate">{book.title}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-wider">{book.type}</span>
                    <span className="text-xs text-gray-400 truncate">{book.keywords.join(', ')}</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <button 
                    onClick={() => onEditQuiz(book.id, 'content')} 
                    className="flex items-center gap-2 px-4 py-2.5 bg-orange-50 text-orange-600 rounded-2xl font-bold text-xs hover:bg-orange-100 transition-all active:scale-95 border border-orange-100"
                  >
                    <Award size={16} />
                    內容測驗
                  </button>
                  <button 
                    onClick={() => onEditQuiz(book.id, 'sel')} 
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-2xl font-bold text-xs hover:bg-blue-100 transition-all active:scale-95 border border-blue-100"
                  >
                    <Sparkles size={16} />
                    SEL 測驗
                  </button>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => setEditingBook(book)} 
                      className="p-3 text-gray-400 hover:bg-gray-100 rounded-2xl transition-all"
                    >
                      <Edit size={20} />
                    </button>
                    <button 
                      onClick={() => onDeleteBook(book.id, book.title)} 
                      className="p-3 text-red-300 hover:bg-red-50 hover:text-red-500 rounded-2xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {books.length === 0 && (
              <div className="p-20 text-center text-gray-400">尚無圖書，請點擊上方按鈕新增。</div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b-2 border-gray-100">
                  <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">維度 / 編號</th>
                  <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">評量細項</th>
                  <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest w-1/3">行為指標描述</th>
                  <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">權重</th>
                  <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-gray-50">
                {selIndicators.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-20 text-center text-gray-400">
                      <div className="flex flex-col items-center gap-3">
                        <FileSpreadsheet size={48} className="opacity-20" />
                        <p>尚未匯入任何評量指標</p>
                        <p className="text-xs mb-4">請點擊上方「預設指標」按鈕，或點擊下方快速載入</p>
                        <button 
                          onClick={handleSeedSEL}
                          className="px-6 py-2 bg-indigo-600 text-white rounded-full text-sm font-bold shadow-lg hover:bg-indigo-700 transition-all active:scale-95"
                        >
                          立即載入您提供的 21 筆指標
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : selIndicators.map((indicator) => (
                  <tr key={indicator.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-8 py-5">
                      <div className="text-sm font-black text-gray-800">{indicator.dimension}</div>
                      <div className="text-[10px] font-mono text-blue-500 bg-blue-50 w-fit px-1.5 rounded mt-1">{indicator.code}</div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-bold text-gray-700">{indicator.subDomain}</div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm text-gray-500 leading-relaxed">{indicator.description}</div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-black">{indicator.weight}</span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setEditingSel(indicator)}
                          className="p-3 text-gray-300 hover:bg-blue-50 hover:text-blue-500 rounded-2xl transition-all"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => handleDeleteSEL(indicator.id!)}
                          className="p-3 text-gray-300 hover:bg-red-50 hover:text-red-500 rounded-2xl transition-all"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor Modals */}
      {editingBook && (
        <BookEditor 
          book={editingBook as BookData} 
          onSave={handleSaveBook} 
          onCancel={() => setEditingBook(null)} 
        />
      )}

      {editingSel && (
        <SELEditor 
          indicator={editingSel as SELIndicator}
          onSave={handleSaveSEL}
          onCancel={() => setEditingSel(null)}
        />
      )}
    </div>
  );
}

function SELEditor({ indicator, onSave, onCancel }: { 
  indicator: SELIndicator, 
  onSave: (ind: SELIndicator) => void, 
  onCancel: () => void 
}) {
  const [formData, setFormData] = useState<SELIndicator>(indicator);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div key="sel-editor-modal" className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-blue-600">🎯 {indicator.id ? '編輯' : '新增'} SEL 指標</h3>
          <button onClick={onCancel} className="text-gray-400 hover:bg-gray-100 p-2 rounded-full"><X size={24} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-gray-600 ml-2">維度名稱</label>
            <select 
              value={formData.dimension}
              onChange={e => setFormData({ ...formData, dimension: e.target.value })}
              className="w-full px-5 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-blue-400 outline-none"
            >
              <option>第一維度：自我覺察</option>
              <option>第二維度：自我管理</option>
              <option>第三維度：社會覺察</option>
              <option>第四維度：人際技巧</option>
              <option>第五維度：負責任的決定</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-600 ml-2">編號</label>
              <input 
                required
                type="text" 
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                placeholder="例如: 1-1-1"
                className="w-full px-5 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-blue-400 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-600 ml-2">建議權重</label>
              <input 
                required
                type="text" 
                value={formData.weight}
                onChange={e => setFormData({ ...formData, weight: e.target.value })}
                placeholder="例如: 7%"
                className="w-full px-5 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-blue-400 outline-none font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-gray-600 ml-2">評量細項 (Sub-domains)</label>
            <input 
              required
              type="text" 
              value={formData.subDomain}
              onChange={e => setFormData({ ...formData, subDomain: e.target.value })}
              placeholder="例如: 情緒顆粒度 (命名)"
              className="w-full px-5 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-blue-400 outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-gray-600 ml-2">測驗重點描述 (行為指標)</label>
            <textarea 
              required
              rows={3}
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="請輸入具體的行為指標描述..."
              className="w-full px-5 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-blue-400 outline-none resize-none"
            />
          </div>

          <button 
            type="submit"
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
          >
            儲存指標設定
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function BookEditor({ book, onSave, onCancel }: { book: BookData, onSave: (b: BookData) => void, onCancel: () => void }) {
  const [formData, setFormData] = useState<BookData>(book);
  const [fileInputKey, setFileInputKey] = useState(Date.now());

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'coverImageUrl' | 'fileData') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 0.8 * 1024 * 1024) {
      alert('⚠️ 檔案太大囉！\nFirebase 資料庫對單一文件有限制 (1MB)。\n您的檔案經 Base64 編碼後會超過限制導致無法儲存。\n請壓縮 PDF 或嘗試改用 YouTube 連結。');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setFormData(prev => ({ ...prev, [field]: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const handleKeywordsChange = (val: string) => {
    const kws = val.split(',').map(k => k.trim()).filter(k => k);
    setFormData(prev => ({ ...prev, keywords: kws }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalData = { ...formData };
    if (!finalData.description) {
      finalData.description = generateDescription(finalData.title, finalData.keywords);
    }
    if (finalData.type === 'youtube') {
      finalData.fileData = getYoutubeId(finalData.fileData);
    }
    onSave(finalData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] overflow-y-auto px-2 py-4 flex justify-center items-start">
      <div className="bg-white rounded-2xl p-4 max-w-2xl w-full shadow-2xl relative mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-orange-600">
            {book.id ? '📖 編輯書籍' : '✨ 新增童書'}
          </h3>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Main Title Field - Single Column for better visibility */}
          <div className="bg-orange-50/30 p-4 rounded-2xl border-2 border-orange-100 space-y-1.5">
            <label className="block text-sm font-black text-orange-700">書名 (必填) <span className="text-red-500">*</span></label>
            <input 
              required
              type="text" 
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-orange-200 focus:border-orange-500 outline-none transition-all font-black text-lg text-orange-900 shadow-sm"
              placeholder="例如：勇敢的小火車"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Left Column */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">作者</label>
                <input 
                  type="text" 
                  value={formData.author}
                  onChange={e => setFormData({ ...formData, author: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-100 focus:border-orange-400 outline-none transition-all text-sm"
                  placeholder="預設為：童書作者"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">書籍類型 <span className="text-red-500">*</span></label>
                <select 
                  value={formData.type}
                  onChange={e => setFormData({ ...formData, type: e.target.value as any, fileData: '' })}
                  className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-100 focus:border-orange-400 outline-none transition-all appearance-none text-sm"
                >
                  <option value="text">📖 純文字故事</option>
                  <option value="youtube">📺 YouTube 影片</option>
                  <option value="pdf">📄 PDF 檔案</option>
                  <option value="video">🎬 一般影片檔 (MP4)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">關鍵字 (以逗號分隔)</label>
                <input 
                  type="text" 
                  value={formData.keywords.join(', ')}
                  onChange={e => handleKeywordsChange(e.target.value)}
                  placeholder="例如：動物, 勇敢, 春天"
                  className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-100 focus:border-orange-400 outline-none transition-all text-sm"
                />
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">封面圖片</label>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <input 
                      key={`cover-${fileInputKey}`}
                      type="file" 
                      accept="image/*"
                      onChange={e => handleFileChange(e, 'coverImageUrl')}
                      className="text-[10px] block w-full text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-100 file:text-orange-700 hover:file:bg-orange-200 cursor-pointer"
                    />
                  </div>
                  {formData.coverImageUrl && (
                    <img src={formData.coverImageUrl || undefined} className="h-12 w-9 object-cover rounded-lg border-2 border-orange-100 shadow-sm" referrerPolicy="no-referrer" />
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {formData.type === 'text' && (
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-700">故事內容 <span className="text-red-500">*</span></label>
                    <textarea 
                      required
                      value={formData.fileData}
                      onChange={e => setFormData({ ...formData, fileData: e.target.value })}
                      rows={4}
                      className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-100 focus:border-orange-400 outline-none transition-all text-xs leading-relaxed"
                      placeholder="在此輸入或貼上故事內容..."
                    ></textarea>
                  </div>
                )}

                {formData.type === 'youtube' && (
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-700">YouTube 網址或 ID <span className="text-red-500">*</span></label>
                    <input 
                      required
                      type="text" 
                      value={formData.fileData}
                      onChange={e => setFormData({ ...formData, fileData: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-100 focus:border-orange-400 outline-none transition-all text-xs"
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                  </div>
                )}

                {(formData.type === 'pdf' || formData.type === 'video') && (
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-700">上傳檔案 ({formData.type.toUpperCase()}) <span className="text-red-500">*</span></label>
                    <input 
                      key={`file-${fileInputKey}`}
                      required={!formData.fileData}
                      type="file" 
                      accept={formData.type === 'pdf' ? 'application/pdf' : 'video/mp4'}
                      onChange={e => handleFileChange(e, 'fileData')}
                      className="text-[10px] block w-full text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 cursor-pointer"
                    />
                    {formData.fileData && (
                      <p className="text-[9px] text-green-600 font-bold mt-0.5 flex items-center gap-1 bg-green-50 px-1.5 py-0.5 rounded-md">
                        <CheckCircle size={10} /> 檔案已備妥 (約 {Math.round((formData.fileData.length * 3 / 4) / 1024)} KB)
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">故事大綱 (推薦語)</label>
                <textarea 
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-100 focus:border-orange-400 outline-none transition-all text-xs"
                  placeholder="留空將根據書名與關鍵字自動產生..."
                ></textarea>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-base shadow-md shadow-orange-50 transition-all active:scale-[0.98]">
              確認儲存
            </button>
            <button type="button" onClick={onCancel} className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl font-bold transition-all text-sm">
              取消
            </button>
          </div>
        </form>
      </div>
    </div>

  );
}

function AdminModal({ onClose, onVerify }: { onClose: () => void, onVerify: (email: string, pass: string) => boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onVerify(email, password)) {
      setError(false);
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-start justify-center p-6 pt-4 md:pt-8">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-3xl p-5 max-w-[300px] w-full shadow-2xl relative space-y-4"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-300 hover:text-gray-500">
          <X size={18} />
        </button>

        <div className="text-center space-y-1">
          <div className="bg-purple-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto text-purple-500">
            <Lock size={20} />
          </div>
          <h3 className="text-lg font-bold">管理者登入</h3>
          <p className="text-[10px] text-gray-500">請輸入管理員信箱與通行密碼</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <input 
              type="email" 
              placeholder="管理員信箱..." 
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(false); }}
              autoFocus
              className={`w-full px-4 py-2 rounded-lg bg-gray-50 border-2 outline-none transition-all text-center text-xs font-bold ${error ? 'border-red-400' : 'focus:border-purple-400 border-transparent'}`}
            />
            <input 
              type="password" 
              placeholder="請輸入密碼..." 
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false); }}
              className={`w-full px-4 py-2 rounded-lg bg-gray-50 border-2 outline-none transition-all text-center text-sm font-bold ${error ? 'border-red-400' : 'focus:border-purple-400 border-transparent'}`}
            />
            {error && <p className="text-center text-red-500 text-[10px] font-bold animate-bounce">帳密錯誤，請再試一次！</p>}
          </div>
          <button 
            type="submit"
            disabled={!email || !password}
            className="w-full py-2.5 rounded-lg bg-purple-500 text-white text-sm font-bold shadow-lg shadow-purple-50 hover:bg-purple-600 active:scale-95 transition-all disabled:opacity-50"
          >
            登入管理中心
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function QuizEditor({ bookId, bookTitle, type, selIndicators, onSave, onCancel }: { 
  bookId: string, 
  bookTitle: string, 
  type: 'content' | 'sel',
  selIndicators: SELIndicator[],
  onSave: (qs: QuizQuestion[]) => void, 
  onCancel: () => void 
}) {
  const [qs, setQs] = useState<QuizQuestion[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [importText, setImportText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showIndicatorsRef, setShowIndicatorsRef] = useState(false);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load quizzes from Firestore based on type
  useEffect(() => {
    const load = async () => {
      try {
        const collectionPath = type === 'content' ? `kidsbook-GitHub-to-Firebase/${bookId}/content_quizzes` : `kidsbook-GitHub-to-Firebase/${bookId}/sel_quizzes`;
        const snapshot = await getDocs(collection(db, collectionPath));
        setQs(snapshot.docs.map(doc => doc.data() as QuizQuestion));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `kidsbook-GitHub-to-Firebase/${bookId}/${type}_quizzes`);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [bookId, type]);

  const handleAIImport = async () => {
    if (!genAI || !importText.trim()) return;
    setIsGenerating(true);
    try {
      // Fetch SEL Standard Content
      const selDoc = await getDoc(doc(db, 'system', 'sel_standard'));
      const selStandard = selDoc.exists() ? selDoc.data().content : INITIAL_SEL_INDICATORS.map(i => `${i.dimension} ${i.code} ${i.subDomain}: ${i.description}`).join('\n');

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const contentPrompt = `你是一位專業的中文兒童教育專家。請根據以下提供的故事內容，生成 3 到 5 個適合國小學生的「故事內容理解」選擇題。
      
      【故事內容】：
      ${importText}
      
      規則：
      1. 題目必須針對故事情節、角色、發生了什麼事等。
      2. 每個題目包含 3 到 4 個選項。
      3. 必須標記正確答案 (0 為第一個，1 為第二個，以此類推)。
      4. 必須為每個題目提供一個簡短的「提示」(hint)，當小朋友答錯時可以引導他們思考。
      5. 輸出格式必須是純 JSON 陣列，例如: [{"question": "...", "options": ["A", "B", "C"], "correctAnswer": 0, "hint": "..."}]。`;

      const selPrompt = `你是一位專業的國小 SEL (社會情緒學習) 教育專家。請根據以下提供的故事內容，並參考下方的「SEL 評量指標」標準，生成 3 到 5 個適合小朋友的「SEL 情境思考」選擇題。
      
      【SEL 評量指標參考標準】：
      ${selStandard}
      
      【故事內容】：
      ${importText}
      
      規則：
      1. 題目必須設定一個與故事相關的情境，詢問小朋友如果他是主角會怎麼做，或主角當時的心情如何。
      2. 每個題目必須連結一個具體的 SEL 指標編號 (selIndicatorId)，例如 "1-1-1"。
      3. 每個題目包含 3 到 4 個選項。
      4. 必須標記「最正確」或「最正向」的答案為正確答案 (0 為第一個)。
      5. 提供簡短「提示」(hint)。
      6. 輸出格式必須是純 JSON 陣列，例如: [{"question": "...", "options": ["選項1", "選項2", "選項3"], "correctAnswer": 0, "hint": "...", "selIndicatorId": "1-1-1"}]。`;

      const promptValue = type === 'content' ? contentPrompt : selPrompt;

      const result = await model.generateContent(promptValue);
      const output = result.response.text();
      const cleanedText = output.replace(/```json|```/g, '').trim();
      
      const parsed = JSON.parse(cleanedText);
      if (Array.isArray(parsed)) {
        const newQs = parsed.map(q => ({ ...q, type }));
        setQs(replaceMode ? newQs : [...qs, ...newQs]);
        setImportText('');
        setShowImport(false);
      }
    } catch (err) {
      console.error(err);
      alert('AI 解析失敗，請檢查 API Key 或手動輸入。');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddQ = () => {
    setQs([...qs, { question: '', options: ['', '', ''], correctAnswer: 0, type, selIndicatorId: type === 'sel' ? selIndicators[0]?.code : undefined }]);
  };

  const handlePasteImport = () => {
    try {
      // 嘗試 JSON 解析
      const data = JSON.parse(pasteText);
      if (Array.isArray(data)) {
        const validated = data.map(q => ({ ...q, type }));
        setQs([...qs, ...validated]);
        setPasteText('');
        setShowPaste(false);
        return;
      }
    } catch (e) {
      // 文本解析邏輯 - 改進分割邏輯，支援「第 N 題」開頭
      const chunks = pasteText.split(/\n\s*(?=第\s*\d+\s*題|(?<!\d\.)\b\d+[\.\、\s])/).filter(c => c.trim());
      
      const parsed: QuizQuestion[] = [];
      
      chunks.forEach(chunk => {
        // 先嘗試解析新式 SEL 格式 (包含 題幹、各選答對應 SEL 指標 等關鍵字)
        if (type === 'sel' && (chunk.includes('題幹') || chunk.includes('各選答對應 SEL 指標'))) {
          const questionPart = chunk.match(/題幹[：:]?\s*([\s\S]*?)(?=選答選項|各選答對應 SEL 指標|參考給分|$)/)?.[1]?.trim();
          const optionsPart = chunk.match(/選答選項[：:]?\s*([\s\S]*?)(?=各選答對應 SEL 指標|參考給分|$)/)?.[1]?.trim();
          const selPart = chunk.match(/各選答對應 SEL 指標[：:]?\s*([\s\S]*?)(?=參考給分|$)/)?.[1]?.trim();
          const scorePart = chunk.match(/參考給分[：:]?\s*([\s\S]*?)$/)?.[1]?.trim();

          if (questionPart) {
            const qObj: QuizQuestion = {
              question: questionPart,
              options: [],
              correctAnswer: 0,
              type: 'sel'
            };

            if (optionsPart) {
              qObj.options = optionsPart.split(/\s*(?:\([A-D]\)|[A-D][\.\、\)])\s*/).filter(p => p.trim()).slice(0, 4);
            }
            if (selPart) {
              qObj.optionSels = selPart.split(/\s*(?:\([A-D]\)|[A-D][\.\、\)])\s*/).filter(p => p.trim()).slice(0, 4);
            }
            if (scorePart) {
              const scores = scorePart.match(/\d+/g);
              if (scores) {
                const sNum = scores.map(Number);
                qObj.optionScores = sNum;
                let maxS = -1;
                sNum.forEach((s, idx) => {
                  if (s > maxS) { maxS = s; qObj.correctAnswer = idx; }
                });
              }
            }
            parsed.push(qObj);
            return;
          }
        }

        // 傳統解析邏輯 (Fallback)
        const cleanChunk = chunk.replace(/^\s*(?:第\s*\d+\s*題\s*[：:]?|\d+[\.\、\s]+)/, '').trim();
        const lines = cleanChunk.split('\n').map(l => l.trim()).filter(l => l);
        
        if (lines.length > 0) {
          const firstOptionIdx = lines.findIndex(l => /\([A-D]\)|[A-D][\.\、\)]/.test(l));
          
          let question = "";
          let optionsLines: string[] = [];
          
          if (firstOptionIdx === -1) {
            question = lines.join(' ');
          } else {
            question = lines.slice(0, firstOptionIdx).join(' ');
            optionsLines = lines.slice(firstOptionIdx);
          }

          let options: string[] = [];
          let correctAnswer = 0;
          let hint = "";

          const optionsText = optionsLines.join('\n');
          const partsSplit = optionsText.split(/(?=正確答案|答案|詳解|解析|HINT|Answer)/i);
          const onlyOptionsText = partsSplit[0];
          const metadataText = partsSplit.slice(1).join('\n');
          
          if (onlyOptionsText) {
            const parts = onlyOptionsText.split(/\s*(?:\([A-D]\)|[A-D][\.\、\)])\s*/).filter(p => p.trim());
            options = parts.slice(0, 4);
          }
          
          if (options.length === 0) options = ['選項 A', '選項 B'];

          const fullMeta = (metadataText || "") + "\n" + optionsText;
          const metaLines = fullMeta.split('\n');
          
          metaLines.forEach(line => {
            const l = line.toUpperCase();
            if (l.includes('正確答案') || l.includes('答案') || l.includes('ANSWER')) {
              if (l.includes('(A)') || l.includes(' A ') || l.match(/[:：]\s*A/)) correctAnswer = 0;
              else if (l.includes('(B)') || l.includes(' B ') || l.match(/[:：]\s*B/)) correctAnswer = 1;
              else if (l.includes('(C)') || l.includes(' C ') || l.match(/[:：]\s*C/)) correctAnswer = 2;
              else if (l.includes('(D)') || l.includes(' D ') || l.match(/[:：]\s*D/)) correctAnswer = 3;
            }
            if (l.includes('詳解') || l.includes('解析') || l.includes('提示') || l.includes('HINT')) {
              const parts = line.split(/[:：]/);
              if (parts.length > 1) hint = parts.slice(1).join(':').trim();
            }
          });

          if (question.length > 0) {
            parsed.push({
              question,
              options: options as [string, string, string, string],
              correctAnswer,
              hint: hint || '請仔細閱讀故事內容喔！',
              type,
              selIndicatorId: type === 'sel' ? (selIndicators[0]?.code || '') : undefined
            });
          }
        }
      });

      if (parsed.length > 0) {
        setQs(replaceMode ? parsed : [...qs, ...parsed]);
        setPasteText('');
        setShowPaste(false);
        return;
      }
    }
    alert('無法解析輸入內容，請確認包含：題名、四個選項、正確答案。');
  };

  const handleClearAll = () => {
    setShowConfirmDelete({ type: 'all' });
  };

  const confirmDelete = () => {
    if (!showConfirmDelete) return;
    if (showConfirmDelete.type === 'one' && showConfirmDelete.index !== undefined) {
      setQs(qs.filter((_, i) => i !== showConfirmDelete.index));
    } else if (showConfirmDelete.type === 'all') {
      setQs([]);
    }
    setShowConfirmDelete(null);
  };

  const scrollToQuestion = (idx: number) => {
    questionRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleImport = () => {
    // Keep internal JSON import if needed
    try {
      const data = JSON.parse(importText);
      if (Array.isArray(data)) {
        const validated = data.map(q => ({ ...q, type }));
        setQs([...qs, ...validated]);
        setImportText('');
        setShowImport(false);
        return;
      }
    } catch (e) {}
  };

  const [showConfirmDelete, setShowConfirmDelete] = useState<{ type: 'one' | 'all', index?: number } | null>(null);

  const handleUpdateQ = (idx: number, field: keyof QuizQuestion, val: any) => {
    const newQs = [...qs];
    newQs[idx] = { ...newQs[idx], [field]: val };
    setQs(newQs);
  };

  const handleUpdateOption = (qIdx: number, optIdx: number, val: string) => {
    const newQs = [...qs];
    const newOpts = [...newQs[qIdx].options];
    newOpts[optIdx] = val;
    newQs[qIdx].options = newOpts;
    setQs(newQs);
  };

  const handleUpdateOptionSels = (qIdx: number, optIdx: number, val: string) => {
    const newQs = [...qs];
    const newSels = [...(newQs[qIdx].optionSels || ['', '', '', ''])];
    newSels[optIdx] = val;
    newQs[qIdx].optionSels = newSels;
    setQs(newQs);
  };

  const handleUpdateOptionScores = (qIdx: number, optIdx: number, val: number) => {
    const newQs = [...qs];
    const newScores = [...(newQs[qIdx].optionScores || [0, 0, 0, 0])];
    newScores[optIdx] = val;
    newQs[qIdx].optionScores = newScores;
    setQs(newQs);
  };

  const handleAddOption = (qIdx: number) => {
    const newQs = [...qs];
    const q = newQs[qIdx];
    if (q.options.length < 4) {
      q.options = [...q.options, ''];
      if (q.optionSels) q.optionSels = [...q.optionSels, ''];
      if (q.optionScores) q.optionScores = [...q.optionScores, 0];
      setQs(newQs);
    }
  };

  const handleRemoveOption = (qIdx: number, optIdx: number) => {
    const newQs = [...qs];
    const q = newQs[qIdx];
    if (q.options.length > 1) {
      q.options = q.options.filter((_, i) => i !== optIdx);
      if (q.optionSels) q.optionSels = q.optionSels.filter((_, i) => i !== optIdx);
      if (q.optionScores) q.optionScores = q.optionScores.filter((_, i) => i !== optIdx);
      // Adjust correct answer if it was on the removed option
      if (q.correctAnswer === optIdx) q.correctAnswer = 0;
      else if (q.correctAnswer > optIdx) q.correctAnswer--;
      setQs(newQs);
    }
  };

  const handleRemoveQ = (idx: number) => {
    setShowConfirmDelete({ type: 'one', index: idx });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-2">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[95vh] flex flex-col shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${type === 'content' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
              {type === 'content' ? <Award size={18} /> : <Sparkles size={18} />}
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-800 leading-tight">{type === 'content' ? '故事核心理解 測驗管理' : 'SEL 情境思考 測驗管理'}</h3>
              <p className="text-[10px] text-gray-500">正在設定：{bookTitle}</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button 
              onClick={() => { setShowPaste(!showPaste); setShowImport(false); }} 
              className="bg-orange-100 text-orange-600 px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 hover:bg-orange-200 transition-colors"
            >
              <FileText size={14} /> 貼上試題
            </button>
            <button 
              onClick={() => { setShowImport(!showImport); setShowPaste(false); }} 
              className="bg-purple-100 text-purple-600 px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 hover:bg-purple-200 transition-colors"
            >
              <Sparkles size={14} /> AI 生成試題
            </button>
            {type === 'sel' && (
              <button 
                onClick={() => setShowIndicatorsRef(true)}
                className="bg-blue-50 text-blue-600 px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 hover:bg-blue-100 transition-all border border-blue-100 flex-shrink-0"
              >
                <Award size={14} /> SEL 指標
              </button>
            )}
            <button 
              onClick={handleClearAll} 
              className="bg-red-50 text-red-500 px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 hover:bg-red-100 transition-all border border-red-100"
            >
              <Trash2 size={14} /> 清空題目
            </button>
            <button 
              onClick={handleAddQ} 
              className="bg-indigo-600 text-white px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 hover:bg-indigo-700 transition-all shadow-md"
            >
              <Plus size={14} /> 新增題目
            </button>
            <button onClick={onCancel} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full ml-2"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto flex">
          {/* Sidebar Overview */}
          <div className="w-48 border-r border-gray-100 bg-gray-50/50 flex-shrink-0 flex flex-col p-2 overflow-auto">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-2">試題概覽 ({qs.length})</h4>
            <div className="space-y-1">
              {qs.map((q, i) => (
                <button 
                  key={i}
                  onClick={() => scrollToQuestion(i)}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-white hover:shadow-sm transition-all group border border-transparent hover:border-gray-100"
                >
                  <div className="flex gap-2">
                    <span className="font-bold text-indigo-600 text-xs">#{i+1}</span>
                    <span className="text-[10px] text-gray-600 line-clamp-1">{q.question || '(未命名問題)'}</span>
                  </div>
                </button>
              ))}
              {qs.length === 0 && <p className="text-[10px] text-gray-400 mt-4 px-2 italic text-center">尚未新增任何試題</p>}
            </div>
          </div>

          {/* Main Content Areas */}
          <div className="flex-1 p-4 space-y-4">
            {showPaste && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="bg-orange-50 p-6 rounded-3xl space-y-4 border-2 border-dashed border-orange-200"
              >
                <div className="flex items-center justify-between">
                  <label className="text-sm font-black text-gray-600">請貼上您從 Gemini 獲得的試題文字</label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1 rounded-lg border border-orange-200 shadow-sm">
                      <input 
                        type="checkbox" 
                        checked={replaceMode} 
                        onChange={e => setReplaceMode(e.target.checked)}
                        className="rounded text-orange-600"
                      />
                      <span className="text-xs font-bold text-gray-600">清空現有題目</span>
                    </label>
                    <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded font-bold uppercase tracking-widest">手動解析模式</span>
                  </div>
                </div>
                <textarea 
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="格式範例：&#10;1. 故事中主角是誰？&#10;(A) 小貓 (B) 小狗 (C) 小兔 (D) 小鴨&#10;正確答案：0&#10;詳解：這是故事的第一段提到的..."
                  className="w-full h-[500px] px-6 py-5 rounded-3xl border-2 border-transparent focus:border-orange-400 outline-none resize-none text-base font-sans shadow-inner bg-white leading-relaxed"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowPaste(false)} className="px-6 py-2 text-gray-400 font-bold">取消</button>
                  <button 
                    disabled={!pasteText.trim()}
                    onClick={handlePasteImport}
                    className="px-8 py-2 bg-orange-600 text-white rounded-xl font-black text-sm flex items-center gap-2 shadow-lg shadow-orange-100"
                  >
                    <CheckCircle size={18} /> {replaceMode ? '取代並存入' : '追加解析並存入'}
                  </button>
                </div>
              </motion.div>
            )}

            {showImport && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="bg-purple-50 p-6 rounded-3xl space-y-4 border-2 border-dashed border-purple-200"
              >
                <div className="flex items-center justify-between">
                  <label className="text-sm font-black text-gray-600">請貼上故事內容 (用於 AI 分析與出題)</label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1 rounded-lg border border-purple-200 shadow-sm">
                      <input 
                        type="checkbox" 
                        checked={replaceMode} 
                        onChange={e => setReplaceMode(e.target.checked)}
                        className="rounded text-purple-600"
                      />
                      <span className="text-xs font-bold text-gray-600">清空現有題目</span>
                    </label>
                    <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-bold uppercase tracking-widest">GEMINI 1.5 PRO 模式</span>
                  </div>
                </div>
                <textarea 
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder="在此處貼入書籍的全文 or 精彩段落，AI 將為您構思有趣的測驗題..."
                  className="w-full h-32 px-4 py-3 rounded-2xl border-2 border-transparent focus:border-indigo-400 outline-none resize-none text-sm bg-white shadow-inner"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowImport(false)} className="px-6 py-2 text-gray-400 font-bold">取消</button>
                  <button 
                    disabled={isGenerating || !importText.trim()}
                    onClick={handleAIImport}
                    className="px-8 py-2 bg-indigo-600 text-white rounded-xl font-black text-sm flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-100"
                  >
                    {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    {isGenerating ? '正在分析情境並出題...' : replaceMode ? '立即 AI 出題並取代' : '立即追加 AI 出題'}
                  </button>
                </div>
              </motion.div>
            )}

            <div className="space-y-4 pb-10">
              {isLoading ? (
                <div className="py-20 text-center flex flex-col items-center gap-3">
                  <Loader2 className="animate-spin text-indigo-500" size={48} />
                  <p className="text-gray-400 font-bold">正在讀取雲端試題...</p>
                </div>
              ) : qs.length === 0 ? (
                <div className="py-20 text-center text-gray-400 border-2 border-dashed border-gray-100 rounded-[32px] flex flex-col items-center gap-4">
                  <FileQuestion size={64} className="opacity-10" />
                  <div className="space-y-1">
                    <p className="font-bold text-lg">尚未建立任何題目</p>
                    <p className="text-xs">您可以手動新增、貼入文字解析，或是使用 AI 直接根據故事生成。</p>
                  </div>
                </div>
              ) : (
                qs.map((q, qIdx) => (
                  <div 
                    key={qIdx} 
                    ref={el => questionRefs.current[qIdx] = el}
                    className={`p-4 rounded-[24px] border-2 space-y-3 relative group transition-all ${q.question ? 'border-gray-100 bg-white' : 'border-indigo-200 bg-indigo-50/20'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-gray-800 text-white flex items-center justify-center font-black text-base">{qIdx + 1}</span>
                        <h4 className="font-black text-gray-400 text-[10px] uppercase tracking-wider">編輯題目詳情</h4>
                      </div>
                      <button 
                        onClick={() => handleRemoveQ(qIdx)}
                        className="p-2 bg-red-50 text-red-400 hover:bg-red-500 hover:text-white rounded-xl transition-all shadow-sm flex items-center gap-1 text-[10px] font-bold"
                      >
                        <Trash2 size={14} /> 刪除此題
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 ml-2 uppercase tracking-widest leading-none">測驗問題核心</label>
                        <textarea 
                          rows={2}
                          className="w-full px-3 py-2 rounded-xl bg-gray-50 border-2 border-transparent focus:border-indigo-400 focus:bg-white outline-none font-bold text-sm leading-snug transition-all"
                          value={q.question}
                          onChange={e => handleUpdateQ(qIdx, 'question', e.target.value)}
                          placeholder="例如：小月是如何進入小灰狼的記憶的？"
                        />
                      </div>
                      {type === 'sel' && (
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-blue-500 ml-2 uppercase tracking-widest">對應 SEL 能力指標</label>
                          <select 
                            className="w-full px-4 py-3 rounded-2xl bg-blue-50/50 border-2 border-transparent focus:border-blue-400 focus:bg-white outline-none text-xs font-black transition-all appearance-none cursor-pointer"
                            value={q.selIndicatorId}
                            onChange={e => handleUpdateQ(qIdx, 'selIndicatorId', e.target.value)}
                          >
                            <option value="">請選擇對應指標...</option>
                            {selIndicators.map(ind => (
                              <option key={ind.code} value={ind.code}>[{ind.code}] {ind.subDomain} - {ind.description.substring(0, 30)}...</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 ml-2 uppercase tracking-widest">選項設定 (請點選正確答案)</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {q.options.map((opt, oIdx) => (
                          <React.Fragment key={oIdx}>
                            <div className="space-y-1">
                              <div 
                                onClick={() => handleUpdateQ(qIdx, 'correctAnswer', oIdx)}
                                className={`group flex items-center gap-2 p-1 rounded-2xl border transition-all cursor-pointer ${q.correctAnswer === oIdx ? 'ring-2 ring-green-100 border-green-500 bg-green-50/30' : 'border-gray-50 bg-gray-50/50 hover:bg-white hover:border-gray-200'}`}
                              >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm transition-all ${q.correctAnswer === oIdx ? 'bg-green-500 text-white' : 'bg-white text-gray-400 group-hover:bg-gray-100'}`}>
                                  {String.fromCharCode(65 + oIdx)}
                                </div>
                                <input 
                                  className="flex-1 bg-transparent border-none outline-none font-bold text-gray-700 py-3 text-sm"
                                  value={opt}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={e => handleUpdateOption(qIdx, oIdx, e.target.value)}
                                  placeholder={`選項 ${String.fromCharCode(65 + oIdx)} 內容...`}
                                />
                                {q.options.length > 2 && (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleRemoveOption(qIdx, oIdx); }}
                                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                                {q.correctAnswer === oIdx && <Check className="text-green-500 mr-2" size={16} />}
                              </div>
                              {type === 'sel' && (
                                <div className="px-3 pb-3 space-y-2 bg-gray-50/30 rounded-b-2xl -mt-3 border-x border-b border-gray-50">
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-black text-blue-500 uppercase tracking-tighter">對應 SEL 指標細節</label>
                                    <input 
                                      className="w-full text-xs bg-white border border-blue-100 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
                                      value={q.optionSels?.[oIdx] || ''}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => handleUpdateOptionSels(qIdx, oIdx, e.target.value)}
                                      placeholder="例如：1-1-1 情緒顆粒度"
                                    />
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <label className="text-[10px] font-black text-orange-500 uppercase tracking-tighter">參考得分</label>
                                    <input 
                                      type="number"
                                      className="w-20 text-xs bg-white border border-orange-100 rounded-lg px-3 py-2 outline-none focus:border-orange-400"
                                      value={q.optionScores?.[oIdx] || 0}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => handleUpdateOptionScores(qIdx, oIdx, parseInt(e.target.value) || 0)}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </React.Fragment>
                        ))}
                        {q.options.length < 4 && (
                          <button 
                            onClick={() => handleAddOption(qIdx)}
                            className="flex items-center justify-center gap-2 p-4 rounded-3xl border-2 border-dashed border-gray-200 text-gray-400 font-bold hover:bg-gray-50 hover:border-indigo-200 hover:text-indigo-400 transition-all shadow-sm"
                          >
                            <Plus size={20} /> 新增選項 {String.fromCharCode(65 + q.options.length)}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-50">
                      <div className="space-y-2">
                        <label className="text-xs font-black text-orange-500 ml-2 uppercase tracking-widest flex items-center gap-1">
                          <MessageCircle size={14} /> 答錯時的引導提示 (Hint)
                        </label>
                        <input 
                          className="w-full px-6 py-4 rounded-3xl bg-orange-50/30 border-2 border-transparent focus:border-orange-200 focus:bg-white outline-none text-sm font-bold text-orange-800 transition-all shadow-sm"
                          value={q.hint || ''}
                          onChange={e => handleUpdateQ(qIdx, 'hint', e.target.value)}
                          placeholder="例如：給予一個引導性的提示句，而不是直接給答案..."
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-4 px-6 py-2 border-t border-gray-100 flex-shrink-0 bg-white shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]">
          <button 
            onClick={() => onSave(qs)}
            className="flex-1 py-2.5 bg-indigo-600 text-white rounded-[12px] font-black text-sm shadow-lg shadow-indigo-100 hover:bg-indigo-700 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
          >
            <Save size={18} /> 儲存目前所有題目 ({qs.length} 題)
          </button>
          <button onClick={onCancel} className="px-6 py-2.5 bg-gray-100 text-gray-500 rounded-[12px] font-black text-sm hover:bg-gray-200 transition-all">取消並離開</button>
        </div>

        {/* Confirmation Modal Overlay */}
        <AnimatePresence>
          {showConfirmDelete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[150] flex items-start justify-center p-4 pt-8 md:pt-12"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center space-y-4"
              >
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                  <Trash2 size={32} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xl font-black text-gray-800">
                    {showConfirmDelete.type === 'all' ? '確定要清空所有題目嗎？' : '確定要刪除此題目嗎？'}
                  </h4>
                  <p className="text-gray-500 text-sm">
                    此動作執行後將無法復原，請確認。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setShowConfirmDelete(null)}
                    className="py-3 bg-gray-100 text-gray-500 rounded-xl font-bold hover:bg-gray-200 transition-all"
                  >
                    取消刪除
                  </button>
                  <button 
                    onClick={confirmDelete}
                    className="py-3 bg-red-600 text-white rounded-xl font-black shadow-lg shadow-red-100 hover:bg-red-700 transition-all"
                  >
                    確定刪除
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* SEL Indicators Reference Modal */}
      <AnimatePresence>
        {showIndicatorsRef && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-3xl overflow-hidden"
            >
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-blue-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100">
                    <Award size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-800">SEL 社會情緒學習指標</h3>
                    <p className="text-sm font-bold text-blue-600">目前資料庫中的最新評量標準對照表</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowIndicatorsRef(false)}
                  className="w-12 h-12 flex items-center justify-center bg-white text-gray-400 hover:text-gray-600 rounded-2xl shadow-sm border border-gray-100 transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 md:p-6 bg-gray-50/30">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {selIndicators.map((ind) => (
                    <div key={ind.code} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-black tracking-widest">{ind.code}</span>
                          <span className="text-xs font-black text-gray-400 uppercase tracking-wider">{ind.dimension}</span>
                        </div>
                        {ind.weight && (
                          <div className="flex items-center gap-1 bg-orange-50 text-orange-600 px-2.5 py-1 rounded-xl text-[10px] font-black border border-orange-100">
                             權重: {ind.weight}
                          </div>
                        )}
                      </div>
                      <h4 className="text-xl font-black text-gray-800 leading-tight">{ind.subDomain}</h4>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-300 uppercase tracking-widest ml-1">指標描述</label>
                        <p className="text-sm text-gray-600 leading-relaxed bg-gray-50/50 p-4 rounded-2xl border border-gray-50">{ind.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="p-6 border-t border-gray-100 text-center bg-white">
                <button 
                  onClick={() => setShowIndicatorsRef(false)}
                  className="px-10 py-4 bg-gray-800 text-white rounded-2xl font-black text-lg hover:bg-black transition-all shadow-xl shadow-gray-200"
                >
                  確認並關閉
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
