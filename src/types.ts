export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  emoji: string;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  emoji: string;
}

export interface Order {
  id: string;
  userId: string;
  items: CartItem[];
  totalPrice: number;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: string;
  createdAt: any;
  location?: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role: 'user' | 'admin';
}

export interface PaymentMethod {
  id: string;
  userId: string;
  type: 'card' | 'upi' | 'wallet';
  provider: string;
  last4?: string;
  isDefault: boolean;
  createdAt: string;
}
