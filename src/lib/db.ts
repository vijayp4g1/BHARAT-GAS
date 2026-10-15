import Dexie, { type EntityTable } from 'dexie';

export interface Consumer {
  id: string;
  consumer_number: string;
  consumer_name: string;
  mobile: string;
  address: string;
  verification_status: 'Pending' | 'Verified' | 'Rejected' | 'Not Collected';
  cylinder_type?: '14.2KG_STD' | '10KG_LITE' | '19KG_COMM' | '5KG_LITE';
  booking_ref?: string;
  area_code?: string;
  created_at: string;
  updated_at?: string;
  synced?: boolean;
  isDeleted?: boolean;
  has_location?: boolean;
  has_photos?: boolean;
  last_interacted_at?: string;
  searchWords?: string[];
}

export interface ConsumerLocation {
  id?: number;
  consumer_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  uploaded_by: string;
  uploaded_at: string;
  synced: boolean;
  isDeleted?: boolean;
}

export interface ConsumerPhoto {
  id?: number;
  consumer_id: string;
  photo_data_url: string; // Base64 for offline storage
  photo_url?: string;     // URL from Supabase storage
  photo_type: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  uploaded_by: string;
  uploaded_at: string;
  synced: boolean;
  isDeleted?: boolean;
}

export interface DeliveryNote {
  id?: number;
  consumer_id: string;
  note: string;
  uploaded_by: string;
  created_at: string;
  synced: boolean;
  isDeleted?: boolean;
}

export interface StaffCylinderSettlement {
  id: string;
  settlement_date: string; // YYYY-MM-DD
  agent_id: string;
  agent_name: string;
  cylinder_price: number; // e.g. 994
  supplied_cylinders: number; // e.g. 40
  cash_cylinders: number; // e.g. 20
  online_cylinders: number; // e.g. 10
  upi_cylinders: number; // e.g. 10
  due_cylinders: number; // e.g. 0
  returned_full_cylinders: number; // e.g. 0
  empty_cylinders: number; // e.g. 40
  expected_cash: number; // cash_cylinders * cylinder_price
  actual_cash: number;
  cash_difference: number; // actual_cash - expected_cash
  online_amount: number; // online_cylinders * cylinder_price
  upi_amount: number; // upi_cylinders * cylinder_price
  total_amount: number; // total value
  status: 'BALANCED' | 'SHORTAGE' | 'EXCESS';
  notes?: string;
  created_at: string;
  updated_at?: string;
  synced?: boolean;
}

const db = new Dexie('BGCLS_Database') as Dexie & {
  consumers: EntityTable<Consumer, 'id'>;
  consumer_locations: EntityTable<ConsumerLocation, 'id'>;
  consumer_photos: EntityTable<ConsumerPhoto, 'id'>;
  delivery_notes: EntityTable<DeliveryNote, 'id'>;
  staff_cylinder_settlements: EntityTable<StaffCylinderSettlement, 'id'>;
};

// Schema declaration
db.version(6).stores({
  consumers: 'id, consumer_number, consumer_name, mobile, synced, isDeleted, *searchWords',
  consumer_locations: '++id, consumer_id, synced',
  consumer_photos: '++id, consumer_id, synced',
  delivery_notes: '++id, consumer_id, synced'
});

db.version(7).stores({
  consumers: 'id, consumer_number, consumer_name, mobile, synced, isDeleted, last_interacted_at, *searchWords'
});

db.version(8).stores({
  consumers: 'id, consumer_number, consumer_name, mobile, cylinder_type, synced, isDeleted, last_interacted_at, *searchWords'
});

db.version(9).stores({
  staff_cylinder_settlements: 'id, settlement_date, agent_id, synced'
});

export default db;
