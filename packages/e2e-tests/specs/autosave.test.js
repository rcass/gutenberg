/**
 * WordPress dependencies
 */
import {
	clickBlockAppender,
	createNewPost,
	getEditedPostContent,
	pressKeyWithModifier,
	publishPost,
	saveDraft,
} from '@wordpress/e2e-test-utils';

// Constant to override editor preference
const AUTOSAVE_INTERVAL_SECONDS = 5;

async function saveDraftWithKeyboard() {
	return pressKeyWithModifier( 'primary', 's' );
}

async function sleep( durationInSeconds ) {
	return new Promise( ( resolve ) =>
		setTimeout( resolve, durationInSeconds * 1000 ) );
}

async function clearSessionStorage() {
	await page.evaluate( () => window.sessionStorage.clear() );
}

async function readSessionStorageAutosave( postId ) {
	return page.evaluate(
		( key ) => window.sessionStorage.getItem( key ),
		`wp-autosave-block-editor-post-${ postId }`
	);
}

async function getCurrentPostId() {
	return page.evaluate(
		() => window.wp.data.select( 'core/editor' ).getCurrentPostId()
	);
}

async function setLocalAutosaveInterval( value ) {
	return page.evaluate( ( _value ) => {
		window.wp.data.dispatch( 'core/edit-post' )
			.__experimentalUpdateLocalAutosaveInterval( _value );
	}, value );
}

function wrapParagraph( text ) {
	return `<!-- wp:paragraph -->
<p>${ text }</p>
<!-- /wp:paragraph -->`;
}

describe( 'autosave', () => {
	beforeEach( async () => {
		await clearSessionStorage();
		await createNewPost();
		await setLocalAutosaveInterval( AUTOSAVE_INTERVAL_SECONDS );
	} );

	it( 'should save to sessionStorage', async () => {
		await clickBlockAppender();
		await page.keyboard.type( 'before save' );
		await saveDraftWithKeyboard();
		await page.keyboard.type( ' after save' );

		// Wait long enough for local autosave to kick in
		await sleep( AUTOSAVE_INTERVAL_SECONDS + 1 );

		const id = await getCurrentPostId();
		const autosave = await readSessionStorageAutosave( id );
		const { content } = JSON.parse( autosave );
		expect( content ).toBe( wrapParagraph( 'before save after save' ) );

		// Test throttling by scattering typing
		await page.keyboard.type( ' 1' );
		await sleep( AUTOSAVE_INTERVAL_SECONDS - 4 );
		await page.keyboard.type( '2' );
		await sleep( 2 );
		await page.keyboard.type( '3' );
		await sleep( 2 );

		const newAutosave = await readSessionStorageAutosave( id );
		expect( JSON.parse( newAutosave ).content ).toBe( wrapParagraph( 'before save after save 123' ) );
	} );

	it( 'should recover from sessionStorage', async () => {
		await clickBlockAppender();
		await page.keyboard.type( 'before save' );
		await saveDraftWithKeyboard();
		await page.keyboard.type( ' after save' );

		// Trigger local autosave
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).localAutosave() );
		// Reload without saving on the server
		await page.reload();

		const notice = await page.$eval( '.components-notice__content', ( element ) => element.innerText );
		expect( notice ).toContain( 'The backup of this post in your browser is different from the version below.' );

		expect( await getEditedPostContent() ).toEqual( wrapParagraph( 'before save' ) );
		await page.click( '.components-notice__action' );
		expect( await getEditedPostContent() ).toEqual( wrapParagraph( 'before save after save' ) );
	} );

	it( 'should clear local autosave after successful remote autosave', async () => {
		await clickBlockAppender();
		await page.keyboard.type( 'before save' );
		await saveDraft();

		await page.keyboard.type( 'after save' );

		// Trigger local autosave
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).localAutosave() );
		expect( await page.evaluate( () => window.sessionStorage.length ) ).toBe( 1 );

		// Trigger remote autosave
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).autosave() );

		expect( await page.evaluate( () => window.sessionStorage.length ) ).toBe( 0 );
	} );

	it( 'shouldn\'t conflict with server-side autosave', async () => {
		await clickBlockAppender();
		await page.keyboard.type( 'before publish' );
		await publishPost();

		await page.type( '.wp-block-paragraph', ' after publish' );

		await sleep( AUTOSAVE_INTERVAL_SECONDS + 2 );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).autosave() );

		await page.reload();

		// Only one autosave notice should be displayed.
		const notices = await page.$$( '.components-notice' );
		expect( notices.length ).toBe( 1 );
	} );

	afterAll( async () => {
		await clearSessionStorage();
	} );
} );
