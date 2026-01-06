# תיקון: שינויים במוצר לא נשמרים בענן

## הבעיה
כאשר עורכים מוצר ולוחצים "שמור שינויים", השינויים נראים כאילו נשמרו (Toast מופיע), אבל כשיוצאים וחוזרים לדף - השינויים לא שם. הסיבה: **plate presets קיימים לא מתעדכנים בענן**.

## ניתוח טכני

### 1. הבעיה ב-`productService.ts` (שורות 161-166)
```typescript
for (const preset of input.platePresets) {
  if (existingIds.has(preset.id)) {
    // Update existing - for now just keep it  <-- הבעיה!
    savedPresets.push(preset);  // רק local, לא ענן
  } else {
    // Create new preset - עובד נכון
    const cloudPreset = await cloudStorage.createPlatePreset(...)
```

### 2. חסרות פונקציות ב-`cloudStorage.ts`
- `updatePlatePreset` - לא קיימת
- `deletePlatePreset` - לא קיימת (יש TODO בקוד)

### 3. מה קורה בפועל
1. משתמש משנה gramsPerUnit מ-0.03 ל-0.15
2. `products.default_grams_per_unit` מתעדכן בענן (עובד)
3. `plate_presets.grams_per_unit` **לא מתעדכן** בענן (באג!)
4. Local cache מתעדכן - נראה תקין
5. בריענון - הנתונים נטענים מהענן (הישנים)

## הפתרון

### שלב 1: הוספת `updatePlatePreset` ל-`cloudStorage.ts`
**קובץ:** `src/services/cloudStorage.ts`
**מיקום:** אחרי `createPlatePreset` (שורה 369)

```typescript
export const updatePlatePreset = async (
  id: string, 
  updates: Partial<DbPlatePreset>
): Promise<DbPlatePreset | null> => {
  const { data, error } = await supabase
    .from('plate_presets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating preset:', error);
    return null;
  }
  
  return data;
};
```

### שלב 2: הוספת `deletePlatePreset` ל-`cloudStorage.ts`
**קובץ:** `src/services/cloudStorage.ts`
**מיקום:** אחרי `updatePlatePreset`

```typescript
export const deletePlatePreset = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('plate_presets')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting preset:', error);
    return false;
  }
  
  return true;
};
```

### שלב 3: עדכון `updateProductCloudFirst` ב-`productService.ts`
**קובץ:** `src/services/productService.ts`
**מיקום:** שורות 147-189 (בלוק הטיפול ב-plate presets)

שינויים:
1. **מחיקת presets שהוסרו** - קריאה ל-`deletePlatePreset`
2. **עדכון presets קיימים** - קריאה ל-`updatePlatePreset`
3. **יצירת presets חדשים** - נשאר כמו שהיה

```typescript
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
      await cloudStorage.deletePlatePreset(existing.id);
      console.log('[ProductService] Deleted preset:', existing.id);
    }
  }
  
  // Update/create presets
  for (const preset of input.platePresets) {
    if (existingIds.has(preset.id)) {
      // UPDATE existing preset in cloud
      const updatedPreset = await cloudStorage.updatePlatePreset(preset.id, {
        name: preset.name,
        units_per_plate: preset.unitsPerPlate,
        cycle_hours: preset.cycleHours,
        grams_per_unit: input.gramsPerUnit || cloudProduct.default_grams_per_unit,
        allowed_for_night_cycle: preset.allowedForNightCycle,
      });
      
      if (updatedPreset) {
        savedPresets.push({
          id: updatedPreset.id,
          name: updatedPreset.name,
          unitsPerPlate: updatedPreset.units_per_plate,
          cycleHours: updatedPreset.cycle_hours,
          riskLevel: preset.riskLevel || 'low',
          allowedForNightCycle: updatedPreset.allowed_for_night_cycle,
          isRecommended: preset.isRecommended,
        });
      }
    } else {
      // Create new preset (existing code)
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
}
```

## סיכום השינויים

| קובץ | שינוי |
|------|-------|
| `src/services/cloudStorage.ts` | הוספת `updatePlatePreset` ו-`deletePlatePreset` |
| `src/services/productService.ts` | עדכון `updateProductCloudFirst` לקרוא לפונקציות החדשות |

## תוצאה צפויה
- שינויים בשם מוצר - נשמרים בענן
- שינויים בגרמים ליחידה - נשמרים בענן (גם ב-products וגם ב-plate_presets)
- עריכת פריסות קיימות - נשמרות בענן
- מחיקת פריסות - נמחקות מהענן
- הוספת פריסות חדשות - נוצרות בענן

## קבצים קריטיים ליישום

- `src/services/cloudStorage.ts` - הוספת פונקציות update/delete ל-plate_presets
- `src/services/productService.ts` - עדכון הלוגיקה של updateProductCloudFirst
- `src/components/products/ProductEditorModal.tsx` - לא נדרש שינוי (כבר קורא ל-updateProductCloudFirst)
