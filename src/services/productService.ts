// Product Service - Cloud-First with localStorage as cache
// Cloud is source of truth, localStorage is cache only

import * as cloudStorage from './cloudStorage';
import { KEYS, Product, PlatePreset } from './storage';

// ============= TYPES =============

export interface CreateProductInput {
  name: string;
  gramsPerUnit: number;
  platePresets: Omit<PlatePreset, 'id'>[];
  material?: string;
  color?: string;
}

export interface UpdateProductInput {
  name?: string;
  gramsPerUnit?: number;
  platePresets?: PlatePreset[];
  material?: string;
  color?: string;
}

// ============= LOCAL CACHE HELPERS =============

const getLocalProducts = (): Product[] => {
  try {
    const item = localStorage.getItem(KEYS.PRODUCTS);
    return item ? JSON.parse(item) : [];
  } catch {
    return [];
  }
};

const setLocalProducts = (products: Product[]): void => {
  localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
};

const updateLocalCache = (product: Product): void => {
  const products = getLocalProducts();
  const index = products.findIndex(p => p.id === product.id);
  if (index >= 0) {
    products[index] = product;
  } else {
    products.push(product);
  }
  setLocalProducts(products);
};

const removeFromLocalCache = (productId: string): void => {
  const products = getLocalProducts().filter(p => p.id !== productId);
  setLocalProducts(products);
};

// ============= CLOUD-FIRST CRUD =============

/**
 * Create a product in the cloud first, then update local cache
 * Uses crypto.randomUUID() for consistent IDs across cloud and local
 */
export const createProductCloudFirst = async (
  workspaceId: string,
  input: CreateProductInput
): Promise<Product> => {
  const productId = crypto.randomUUID();
  
  // 1. Create product in cloud
  const cloudProduct = await cloudStorage.createProduct(workspaceId, {
    name: input.name,
    material: input.material || 'PLA',
    color: input.color || 'Black',
    default_grams_per_unit: input.gramsPerUnit,
    default_units_per_plate: input.platePresets[0]?.unitsPerPlate || 1,
    default_print_time_hours: input.platePresets[0]?.cycleHours || 1,
    notes: null,
  });
  
  if (!cloudProduct) {
    throw new Error('Failed to create product in cloud');
  }
  
  // 2. Create plate presets in cloud
  const savedPresets: PlatePreset[] = [];
  for (const preset of input.platePresets) {
    const presetId = crypto.randomUUID();
    const cloudPreset = await cloudStorage.createPlatePreset(workspaceId, {
      product_id: cloudProduct.id,
      name: preset.name,
      units_per_plate: preset.unitsPerPlate,
      cycle_hours: preset.cycleHours,
      grams_per_unit: input.gramsPerUnit,
      allowed_for_night_cycle: preset.allowedForNightCycle,
    });
    
    if (cloudPreset) {
      savedPresets.push({
        id: cloudPreset.id,
        name: cloudPreset.name,
        unitsPerPlate: cloudPreset.units_per_plate,
        cycleHours: cloudPreset.cycle_hours,
        riskLevel: preset.riskLevel || 'low',
        allowedForNightCycle: cloudPreset.allowed_for_night_cycle,
        isRecommended: preset.isRecommended || savedPresets.length === 0,
      });
    }
  }
  
  // 3. Create local product model
  const localProduct: Product = {
    id: cloudProduct.id,
    name: cloudProduct.name,
    gramsPerUnit: cloudProduct.default_grams_per_unit,
    platePresets: savedPresets,
  };
  
  // 4. Update local cache
  updateLocalCache(localProduct);
  
  console.log('[ProductService] Created product:', localProduct.id);
  return localProduct;
};

/**
 * Update a product in the cloud first, then update local cache
 */
export const updateProductCloudFirst = async (
  productId: string,
  workspaceId: string,
  input: UpdateProductInput
): Promise<Product> => {
  // 1. Update product in cloud
  const updateData: Partial<cloudStorage.DbProduct> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.gramsPerUnit !== undefined) updateData.default_grams_per_unit = input.gramsPerUnit;
  if (input.material !== undefined) updateData.material = input.material;
  if (input.color !== undefined) updateData.color = input.color;
  
  const cloudProduct = await cloudStorage.updateProduct(productId, updateData);
  
  if (!cloudProduct) {
    throw new Error('Failed to update product in cloud');
  }
  
  // 2. Handle plate presets if provided
  let savedPresets: PlatePreset[] = [];
  if (input.platePresets) {
    // Get existing cloud presets
    const existingPresets = await cloudStorage.getPlatePresets(workspaceId, productId);
    const existingIds = new Set(existingPresets.map(p => p.id));
    const inputIds = new Set(input.platePresets.map(p => p.id));
    
    // Delete removed presets
    for (const existing of existingPresets) {
      if (!inputIds.has(existing.id)) {
        // TODO: Add deletePlatePreset to cloudStorage
        console.log('[ProductService] Would delete preset:', existing.id);
      }
    }
    
    // Update/create presets
    for (const preset of input.platePresets) {
      if (existingIds.has(preset.id)) {
        // Update existing - for now just keep it
        savedPresets.push(preset);
      } else {
        // Create new preset
        const cloudPreset = await cloudStorage.createPlatePreset(workspaceId, {
          product_id: productId,
          name: preset.name,
          units_per_plate: preset.unitsPerPlate,
          cycle_hours: preset.cycleHours,
          grams_per_unit: input.gramsPerUnit || cloudProduct.default_grams_per_unit,
          allowed_for_night_cycle: preset.allowedForNightCycle,
        });
        
        if (cloudPreset) {
          savedPresets.push({
            id: cloudPreset.id,
            name: cloudPreset.name,
            unitsPerPlate: cloudPreset.units_per_plate,
            cycleHours: cloudPreset.cycle_hours,
            riskLevel: preset.riskLevel || 'low',
            allowedForNightCycle: cloudPreset.allowed_for_night_cycle,
            isRecommended: preset.isRecommended,
          });
        }
      }
    }
  } else {
    // Keep existing presets from local cache
    const localProducts = getLocalProducts();
    const existing = localProducts.find(p => p.id === productId);
    savedPresets = existing?.platePresets || [];
  }
  
  // 3. Create local product model
  const localProduct: Product = {
    id: cloudProduct.id,
    name: cloudProduct.name,
    gramsPerUnit: cloudProduct.default_grams_per_unit,
    platePresets: savedPresets,
  };
  
  // 4. Update local cache
  updateLocalCache(localProduct);
  
  console.log('[ProductService] Updated product:', localProduct.id);
  return localProduct;
};

/**
 * Delete a product from the cloud and local cache
 */
export const deleteProductCloudFirst = async (productId: string, workspaceId?: string): Promise<boolean> => {
  console.log('[ProductService] Deleting product from cloud:', productId, 'workspace:', workspaceId);
  
  try {
    // 1. Delete from cloud - now throws on error
    await cloudStorage.deleteProduct(productId, workspaceId);
  } catch (error) {
    console.error('[ProductService] Cloud delete failed:', error);
    throw error; // Re-throw to caller
  }
  
  // 2. Remove from local cache only after cloud success
  removeFromLocalCache(productId);
  
  console.log('[ProductService] Deleted product:', productId);
  return true;
};

/**
 * Get all products - from local cache (which should be hydrated from cloud)
 */
export const getProductsCached = (): Product[] => {
  return getLocalProducts();
};

/**
 * Get a single product by ID - from local cache
 */
export const getProductByIdCached = (productId: string): Product | undefined => {
  return getLocalProducts().find(p => p.id === productId);
};

/**
 * Hydrate local cache from cloud
 * Called on app startup or after login
 */
export const hydrateProductsFromCloud = async (workspaceId: string): Promise<Product[]> => {
  // 1. Fetch products from cloud
  const cloudProducts = await cloudStorage.getProducts(workspaceId);
  
  // 2. Fetch all presets
  const cloudPresets = await cloudStorage.getPlatePresets(workspaceId);
  
  // 3. Group presets by product
  const presetsByProduct = new Map<string, cloudStorage.DbPlatePreset[]>();
  for (const preset of cloudPresets) {
    if (preset.product_id) {
      const existing = presetsByProduct.get(preset.product_id) || [];
      existing.push(preset);
      presetsByProduct.set(preset.product_id, existing);
    }
  }
  
  // 4. Map to local format
  const localProducts: Product[] = cloudProducts.map(cp => ({
    id: cp.id,
    name: cp.name,
    gramsPerUnit: cp.default_grams_per_unit,
    platePresets: (presetsByProduct.get(cp.id) || []).map((preset, idx) => ({
      id: preset.id,
      name: preset.name,
      unitsPerPlate: preset.units_per_plate,
      cycleHours: preset.cycle_hours,
      riskLevel: 'low' as const, // Default - not stored in cloud
      allowedForNightCycle: preset.allowed_for_night_cycle,
      isRecommended: idx === 0, // First one is recommended by default
    })),
  }));
  
  // 5. Update local cache
  setLocalProducts(localProducts);
  
  console.log('[ProductService] Hydrated', localProducts.length, 'products from cloud');
  return localProducts;
};
