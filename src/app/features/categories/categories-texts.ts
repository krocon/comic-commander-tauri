import { ImportNote } from '../../core/categories/categories.models';
import { ProblemCode } from './category-form';

/**
 * Texts of the category dialogs (English = source; German follows in prompt 009).
 */
export const CATEGORIES_TEXTS = {
  manageTitle: 'Manage categories',
  listLabel: 'Categories',
  untitled: '(new category)',
  add: 'Add',
  remove: 'Remove',
  moveUp: 'Move up',
  moveDown: 'Move down',
  importOld: 'Import old config…',
  title: 'Title',
  titlePlaceholder: 'Folder name if empty',
  folder: 'Folder',
  folderPlaceholder: '/path/to/comics or ~/Comics',
  choose: 'Choose…',
  extensions: 'File types',
  icon: 'Icon',
  sizes: 'Thumbnail sizes',
  width: 'Width',
  height: 'Height',
  suffix: 'Sidecar suffix',
  suffixHint: 'Suffix of old thumbnail files next to the books, e.g. “_xl” for “Band_xl.jpg”.',
  defaultSize: 'Default',
  addSize: 'Add size',
  removeSize: 'Remove size',
  initialFilter: 'Initial filter',
  initialFilterHint: 'Used when the category is opened for the first time.',
  empty: 'No category yet. Add one or import the config of the old Comic Commander.',
  save: 'Save',
  cancel: 'Cancel',
  discardQuestion: 'Discard your changes?',
  discard: 'Discard',
  keepEditing: 'Keep editing',
  problem: (code: ProblemCode): string => {
    switch (code) {
      case 'base_dir_missing':
        return 'Please choose a folder.';
      case 'no_extension':
        return 'Choose at least one file type.';
      case 'no_size':
        return 'At least one thumbnail size is needed.';
      case 'too_many_sizes':
        return 'At most five thumbnail sizes.';
      case 'size_out_of_range':
        return 'Sizes must be whole numbers from 32 to 2000 px.';
      case 'bad_suffix':
        return 'The suffix may not contain / \\ : and has at most 20 characters.';
    }
  },
  importTitle: 'Import old configuration',
  importIntro: (file: string) => `Categories found in ${file}:`,
  importNone: 'The file contains no usable category.',
  importColTitle: 'Title',
  importColFolder: 'Folder',
  importColTypes: 'File types',
  importColSizes: 'Sizes',
  importColNotes: 'Notes',
  importSkipped: 'Not imported:',
  importAdd: 'Add selected',
  note: (n: ImportNote): string => {
    switch (n.code) {
      case 'missing_dir':
        return 'Folder not found (imported anyway).';
      case 'unsupported_extension':
        return `File type ${n.detail ?? ''} is not supported.`;
      case 'duplicate':
        return 'Already exists.';
      case 'invalid_dims':
        return `Size ${n.detail ?? ''} is outside 32–2000 px.`;
      case 'invalid_dir':
        return 'No absolute folder.';
      case 'no_extension':
        return 'No supported file type.';
    }
  },
};
