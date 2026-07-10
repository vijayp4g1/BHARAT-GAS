import Dexie, { type EntityTable } from 'dexie';

export interface Consumer {
  id: string;
  consumer_number: string;
  consumer_name: string;
  mobile: string;
  address: string;
  verification_status: 'Pending' | 'Verified' | 'Rejected' | 'Not Collected';
  area_code?: string;
  created_at: string;
  synced?: boolean;
  isDeleted?: boolean;
  has_location?: boolean;
  has_photos?: boolean;
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

const db = new Dexie('BGCLS_Database') as Dexie & {
  consumers: EntityTable<Consumer, 'id'>;
  consumer_locations: EntityTable<ConsumerLocation, 'id'>;
  consumer_photos: EntityTable<ConsumerPhoto, 'id'>;
  delivery_notes: EntityTable<DeliveryNote, 'id'>;
};

// Schema declaration
db.version(5).stores({
  consumers: 'id, consumer_number, consumer_name, mobile, synced, isDeleted',
  consumer_locations: '++id, consumer_id, synced',
  consumer_photos: '++id, consumer_id, synced',
  delivery_notes: '++id, consumer_id, synced'
});

export default db;
